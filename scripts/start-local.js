// One-command local startup (works on a new PC after `npm run setup`).
//   1. PostgreSQL service, cscfeed database/roles, migrations   (start-local-dev.js --prepare-only)
//   2. Super User account: create it if missing, fail early with the real error
//   3. Start API + web, wait until the API reports ready, print how to sign in
// Run via `npm run start:local` (or scripts\start-local.ps1) so dependencies are checked first.
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import bcrypt from "bcryptjs";
import { config } from "dotenv";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.chdir(root);
config({ path: path.join(root, ".env"), quiet: true });

const step = (number, message) => console.info(`\n[${number}/3] ${message}`);
const fail = (message) => {
  console.error(`\nLocal startup failed: ${message}`);
  process.exit(1);
};

function run(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
    child.once("error", reject);
    child.once("close", (code) => resolve(code ?? 1));
  });
}

function npmCommand(args) {
  const npmCli = process.env.npm_execpath;
  return npmCli
    ? [process.execPath, [npmCli, ...args], {}]
    : [`npm ${args.join(" ")}`, [], { shell: true }];
}

async function prepareDatabase() {
  step(1, "Preparing PostgreSQL database and migrations");
  const code = await run(process.execPath, [path.join("scripts", "start-local-dev.js"), "--prepare-only"]);
  if (code !== 0) fail("the database step did not complete (see the message above).");
  // start-local-dev.js may have created or rotated credentials in .env; reload them.
  config({ path: path.join(root, ".env"), override: true, quiet: true });
}

async function ensureSuperUser() {
  step(2, "Checking the Super User account");
  const { getDatabase } = await import("../server/db.js");
  const { bootstrapApplication } = await import("../server/bootstrap.js");
  const { db, client } = getDatabase();
  try {
    await bootstrapApplication({ db });
    const { rows } = await client.query(`
      SELECT a.active, a.account_role, c.password_hash
        FROM cscfeed.auth_credentials c
        JOIN cscfeed.accounts a ON a.id = c.account_id
       WHERE c.username = 'admin'`);
    const admin = rows[0];
    if (!admin) fail("the Super User account was not created.");
    if (!admin.active || admin.account_role !== "super_admin") {
      fail(`the Super User account is ${admin.active ? "" : "inactive "}with role "${admin.account_role}". Run npm run admin:doctor.`);
    }
    const initialPassword = process.env.BOOTSTRAP_ADMIN_PASSWORD || "admin123";
    const usesInitial = await bcrypt.compare(initialPassword, admin.password_hash);
    console.info("Super User is ready.");
    return usesInitial
      ? "username admin, password = BOOTSTRAP_ADMIN_PASSWORD in .env (admin123 by default)"
      : "username admin and your changed password (forgot it? npm run admin:doctor -- --reset)";
  } catch (error) {
    fail(`could not create or check the Super User: ${error.message}${error.code ? ` (code ${error.code})` : ""}`);
  } finally {
    await client.end().catch(() => {});
  }
}

async function waitForApi(apiPort, stack) {
  const deadline = Date.now() + 90_000;
  let lastError = "";
  while (Date.now() < deadline && stack.exitCode === null) {
    try {
      const response = await fetch(`http://127.0.0.1:${apiPort}/api/health`);
      const body = await response.json().catch(() => ({}));
      if (body.ready) return { ready: true };
      if (body.error) return { ready: false, error: body.error };
    } catch (error) {
      lastError = error.cause?.code || error.message;
    }
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  return { ready: false, error: stack.exitCode !== null ? "the API process exited" : `no response from the API (${lastError})` };
}

async function main() {
  await prepareDatabase();
  const signInHint = await ensureSuperUser();

  step(3, "Starting the CSC Feed API and web app");
  const apiPort = Number(process.env.PORT || 5001);
  const [command, args, options] = npmCommand(["run", "dev:stack"]);
  const stack = spawn(command, args, { cwd: root, stdio: "inherit", ...options });
  stack.once("error", (error) => fail(`could not start the dev servers: ${error.message}`));
  const stopStack = () => { if (stack.exitCode === null) stack.kill(); };
  process.once("SIGINT", stopStack);
  process.once("SIGTERM", stopStack);

  const status = await waitForApi(apiPort, stack);
  if (status.ready) {
    console.info([
      "",
      "==========================================================",
      " CSC Feed is running",
      "   App:  http://localhost:5173",
      `   API:  http://localhost:${apiPort}`,
      ` Super User: Administrator tab, ${signInHint}`,
      " Press Ctrl+C to stop.",
      "==========================================================",
      "",
    ].join("\n"));
  } else {
    console.error(`\nThe API is not ready: ${status.error}. Check the [api] lines above.`);
  }

  const code = await new Promise((resolve) => stack.once("close", (exitCode) => resolve(exitCode ?? 0)));
  process.exitCode = code;
}

main().catch((error) => fail(error.message));
