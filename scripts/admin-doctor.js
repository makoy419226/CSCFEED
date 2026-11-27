// Diagnose (and optionally fix) Super User sign-in on this PC's local database.
//   npm run admin:doctor            check only
//   npm run admin:doctor -- --reset  check, then set a new Super User password
// Run it while the API is stopped or running; it only touches the admin login.
import bcrypt from "bcryptjs";
import { config } from "dotenv";
import path from "node:path";
import { fileURLToPath } from "node:url";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
config({ path: path.join(root, ".env"), quiet: true });
const wantsReset = process.argv.includes("--reset");

const ok = (message) => console.info(`  OK    ${message}`);
const bad = (message) => console.info(`  FAIL  ${message}`);
const note = (message) => console.info(`        ${message}`);

function askSecret(prompt) {
  if (process.env.CSCFEED_NEW_ADMIN_PASSWORD) return Promise.resolve(process.env.CSCFEED_NEW_ADMIN_PASSWORD);
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    return Promise.reject(new Error("Run this in an interactive terminal to type the new password."));
  }
  process.stdout.write(`${prompt}: `);
  process.stdin.setRawMode(true);
  process.stdin.resume();
  return new Promise((resolve, reject) => {
    let value = "";
    const restore = () => {
      process.stdin.removeListener("data", onData);
      process.stdin.setRawMode(false);
      process.stdin.pause();
      process.stdout.write("\n");
    };
    const onData = (chunk) => {
      for (const character of chunk.toString("utf8")) {
        if (character === "\u0003") { restore(); reject(new Error("Cancelled.")); return; }
        if (character === "\r" || character === "\n") { restore(); resolve(value); return; }
        if (character === "\u007f" || character === "\b") value = value.slice(0, -1);
        else value += character;
      }
    };
    process.stdin.on("data", onData);
  });
}

async function main() {
  console.info("CSC Feed Super User check\n");

  if (!process.env.DATABASE_URL) {
    bad("DATABASE_URL is not set in .env. Run npm run setup (or npm run dev) first.");
    return 1;
  }
  const target = new URL(process.env.DATABASE_URL);
  const client = new pg.Client({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    ok(`Connected to database "${target.pathname.slice(1)}" at ${target.hostname}:${target.port || 5432}`);
  } catch (error) {
    bad(`Cannot connect to PostgreSQL: ${error.message}`);
    note("Start the PostgreSQL service, or run npm run dev to recover the database credentials.");
    return 1;
  }

  try {
    const columns = await client.query(`
      SELECT table_name, column_name FROM information_schema.columns
       WHERE table_schema = 'cscfeed'
         AND ((table_name = 'reports' AND column_name = 'uploader_name')
           OR (table_name = 'projects' AND column_name = 'manager_id')
           OR (table_name = 'auth_credentials' AND column_name = 'password_hash'))`);
    const has = (table, column) => columns.rows.some((row) => row.table_name === table && row.column_name === column);
    if (!has("auth_credentials", "password_hash")) {
      bad("Login tables are missing: the database migrations have not been applied.");
      note("Run npm run dev and wait for \"Database is ready\" before signing in.");
      return 1;
    }
    if (!has("reports", "uploader_name") || !has("projects", "manager_id")) {
      bad("Some migrations are missing (003/004). The API may run in degraded mode.");
      note("Stop the dev server and run npm run dev again so it applies all migrations.");
    } else {
      ok("Database migrations are applied");
    }

    const { rows } = await client.query(`
      SELECT a.id, a.punch_id, a.account_role, a.active, c.username, c.password_hash
        FROM cscfeed.auth_credentials c
        JOIN cscfeed.accounts a ON a.id = c.account_id
       WHERE c.username = 'admin'`);
    const admin = rows[0];
    if (!admin) {
      bad("No Super User (username \"admin\") exists yet.");
      note("It is created when the API starts successfully. Run npm run dev, then sign in with");
      note("username admin and the BOOTSTRAP_ADMIN_PASSWORD from .env (admin123 if unset).");
      return 1;
    }
    ok(`Super User account exists (username "admin", Punch ID ${admin.punch_id})`);

    let healthy = true;
    if (admin.account_role !== "super_admin") {
      bad(`Account role is "${admin.account_role}", expected "super_admin". Restart the API (npm run dev) to repair it.`);
      healthy = false;
    } else ok("Account role is super_admin");
    if (!admin.active) {
      bad("The Super User account is inactive.");
      healthy = false;
    } else ok("Account is active");

    const bootstrapPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "admin123";
    const bootstrapMatches = await bcrypt.compare(bootstrapPassword, admin.password_hash);
    if (bootstrapMatches) {
      ok("Password is still the initial BOOTSTRAP_ADMIN_PASSWORD from .env");
      note("Sign in on the Administrator tab with username \"admin\" and that password.");
    } else {
      note("Password has been changed from the initial BOOTSTRAP_ADMIN_PASSWORD.");
      note("Note: each PC has its own database; a password changed on another PC does not apply here.");
    }
    note("Use the \"Administrator\" sign-in tab (not the Punch ID / employee tab).");

    if (!wantsReset) {
      if (!bootstrapMatches) note("Forgot it? Run: npm run admin:doctor -- --reset");
      return healthy ? 0 : 1;
    }

    console.info("\nReset the Super User password (12 to 72 characters).");
    const password = await askSecret("New password");
    if (password.length < 12 || Buffer.byteLength(password, "utf8") > 72) {
      bad("Password must be 12 to 72 characters. Nothing was changed.");
      return 1;
    }
    if (!process.env.CSCFEED_NEW_ADMIN_PASSWORD && password !== await askSecret("Confirm password")) {
      bad("Passwords do not match. Nothing was changed.");
      return 1;
    }
    const passwordHash = await bcrypt.hash(password, 12);
    await client.query("BEGIN");
    try {
      await client.query("UPDATE cscfeed.auth_credentials SET password_hash = $1 WHERE account_id = $2", [passwordHash, admin.id]);
      await client.query("DELETE FROM cscfeed.auth_sessions WHERE account_id = $1", [admin.id]);
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
    ok("Super User password updated and existing admin sessions signed out.");
    note("Sign in on the Administrator tab with username \"admin\" and the new password.");
    return healthy ? 0 : 1;
  } finally {
    await client.end();
  }
}

main()
  .then((code) => { process.exitCode = code; })
  .catch((error) => {
    console.error(`Super User check failed: ${error.message}`);
    process.exitCode = 1;
  });
