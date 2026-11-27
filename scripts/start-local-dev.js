import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { config } from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const { Client } = pg;
process.chdir(root);
config({ path: envPath });

function isTemplateUrl(value) {
  return !value || value.includes("change-me");
}

function connectionUrl({ user, password, host, port, database }) {
  const url = new URL(`postgres://${encodeURIComponent(user)}@${host}:${port}/${encodeURIComponent(database)}`);
  url.password = password;
  return url.toString();
}

function quoteIdentifier(value) {
  return `"${value.replaceAll('"', '""')}"`;
}

async function assertPortAvailable(port, service, hosts) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error(`${service} port must be a number from 1 to 65535.`);
  }
  for (const host of hosts) {
    await new Promise((resolve, reject) => {
      const probe = createServer();
      probe.once("error", (error) => {
        if (error.code === "EADDRINUSE") {
          reject(new Error(`${service} port ${port} is already in use. Stop the existing process before starting another copy.`));
        } else {
          reject(error);
        }
      });
      probe.listen(port, host, () => {
        probe.close((error) => error ? reject(error) : resolve());
      });
    });
  }
}

async function assertDevelopmentPortsAvailable() {
  const apiPort = Number(process.env.PORT || 5001);
  await assertPortAvailable(apiPort, "API", ["127.0.0.1"]);
  await assertPortAvailable(5173, "Web", ["127.0.0.1", "::1"]);
}

async function askText(prompt, defaultValue) {
  const readline = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const answer = await new Promise((resolve) => {
      readline.question(`${prompt} [${defaultValue}]: `, resolve);
    });
    return answer.trim() || defaultValue;
  } finally {
    readline.close();
  }
}

async function askSecret(prompt) {
  if (process.env.CSCFEED_POSTGRES_ADMIN_PASSWORD) {
    return process.env.CSCFEED_POSTGRES_ADMIN_PASSWORD;
  }
  if (!process.stdin.isTTY || typeof process.stdin.setRawMode !== "function") {
    throw new Error("Run this command in an interactive terminal to enter the PostgreSQL admin password securely.");
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
        if (character === "\u0003") {
          restore();
          reject(new Error("PostgreSQL setup was cancelled."));
          return;
        }
        if (character === "\r" || character === "\n") {
          restore();
          resolve(value);
          return;
        }
        if (character === "\u007f" || character === "\b") {
          value = value.slice(0, -1);
        } else {
          value += character;
        }
      }
    };
    process.stdin.on("data", onData);
  });
}

async function startPostgresServiceIfStopped() {
  if (process.platform !== "win32") return;
  const command = [
    "$services = @(Get-Service -Name 'postgresql*' -ErrorAction SilentlyContinue)",
    "if ($services.Count -eq 0) { Write-Error 'No PostgreSQL Windows service was found.'; exit 2 }",
    "$running = @($services | Where-Object { $_.Status -eq 'Running' })",
    "if ($running.Count -gt 0) { Write-Output ('PostgreSQL service is running: ' + $running[0].Name); exit 0 }",
    "if ($services.Count -gt 1) { Write-Error 'Multiple stopped PostgreSQL services found; start the intended one manually.'; exit 3 }",
    "Start-Service -Name $services[0].Name -ErrorAction Stop",
    "Write-Output ('Started PostgreSQL service: ' + $services[0].Name)",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.status !== 0) {
    throw new Error("Could not start PostgreSQL. Start its Windows service manually (or run this terminal with permission), then retry.");
  }
  process.stdout.write(result.stdout);
}

async function connectClient(url, label) {
  const client = new Client({ connectionString: url, connectionTimeoutMillis: 5000 });
  try {
    await client.connect();
    return client;
  } catch (error) {
    await client.end().catch(() => {});
    if (error.code === "28P01") {
      throw new Error(`${label} credentials were rejected. Check the local .env connection settings.`);
    }
    if (error.code === "3D000") {
      throw new Error(`${label} database does not exist. Use the first-run setup with an unused local database, or correct .env.`);
    }
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      throw new Error(`Could not connect to PostgreSQL for ${label}. Confirm the service and host/port, then retry.`);
    }
    throw new Error(`Could not connect to PostgreSQL for ${label}: ${error.message}`);
  }
}

async function saveDatabaseUrls(databaseUrl, migrationUrl) {
  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents ? contents.split(/\r?\n/) : [];
  if (lines[lines.length - 1] === "") lines.pop();
  for (const [key, value] of [
    ["DATABASE_URL", databaseUrl],
    ["MIGRATION_DATABASE_URL", migrationUrl],
  ]) {
    const index = lines.findIndex((line) => new RegExp(`^\\s*${key}\\s*=`).test(line));
    const setting = `${key}=${value}`;
    if (index >= 0) lines[index] = setting;
    else lines.push(setting);
  }
  await writeFile(envPath, `${lines.join(newline)}${newline}`, {
    encoding: "utf8",
    mode: 0o600,
  });
}

async function bootstrapLocalDatabase() {
  if (!process.stdin.isTTY) {
    throw new Error("Run npm run dev:local in an interactive terminal to finish first-run PostgreSQL setup.");
  }
  console.info("First-run setup: create a local cscfeed database and dedicated roles.");
  const host = await askText("PostgreSQL host", "127.0.0.1");
  const portText = await askText("PostgreSQL port", "5432");
  const port = Number(portText);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("PostgreSQL port must be a number from 1 to 65535.");
  }
  const adminUser = await askText("PostgreSQL administrator username", "postgres");
  const adminPassword = await askSecret("PostgreSQL administrator password");
  if (!adminPassword) throw new Error("The PostgreSQL administrator password cannot be empty.");

  const adminUrl = connectionUrl({
    user: adminUser,
    password: adminPassword,
    host,
    port,
    database: "postgres",
  });
  const admin = await connectClient(adminUrl, "PostgreSQL administrator");
  let rolesCreated = false;
  let databaseCreated = false;
  try {
    const roles = await admin.query(
      "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])",
      [["cscfeed_owner", "cscfeed_app"]],
    );
    if (roles.rowCount) {
      throw new Error("A cscfeed_owner or cscfeed_app role already exists. Configure valid URLs in .env; existing role passwords will not be changed.");
    }
    const database = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", ["cscfeed"]);
    if (database.rowCount) {
      throw new Error("The cscfeed database already exists. It will not be modified by first-run setup; configure its existing URLs in .env.");
    }

    const ownerPassword = randomBytes(32).toString("hex");
    const appPassword = randomBytes(32).toString("hex");
    await admin.query("BEGIN");
    try {
      await admin.query(`CREATE ROLE cscfeed_owner LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${ownerPassword}'`);
      await admin.query(`CREATE ROLE cscfeed_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE PASSWORD '${appPassword}'`);
      await admin.query("COMMIT");
      rolesCreated = true;
    } catch (error) {
      await admin.query("ROLLBACK");
      throw error;
    }
    await admin.query("CREATE DATABASE cscfeed OWNER cscfeed_owner");
    databaseCreated = true;

    const databaseUrl = connectionUrl({
      user: "cscfeed_app",
      password: appPassword,
      host,
      port,
      database: "cscfeed",
    });
    const migrationUrl = connectionUrl({
      user: "cscfeed_owner",
      password: ownerPassword,
      host,
      port,
      database: "cscfeed",
    });
    await saveDatabaseUrls(databaseUrl, migrationUrl);
    process.env.DATABASE_URL = databaseUrl;
    process.env.MIGRATION_DATABASE_URL = migrationUrl;
    console.info("Created the local database and roles; generated credentials were saved to the Git-ignored .env.");
  } catch (error) {
    if (rolesCreated && !databaseCreated) {
      await admin.query("DROP ROLE IF EXISTS cscfeed_app").catch(() => {});
      await admin.query("DROP ROLE IF EXISTS cscfeed_owner").catch(() => {});
    }
    throw error;
  } finally {
    await admin.end();
  }
}

async function grantRuntimeAccess(migrationClient, databaseUrl) {
  const owner = decodeURIComponent(new URL(process.env.MIGRATION_DATABASE_URL).username);
  const runtime = decodeURIComponent(new URL(databaseUrl).username);
  const runtimeRole = quoteIdentifier(runtime);
  const ownerRole = quoteIdentifier(owner);
  await migrationClient.query(`GRANT USAGE ON SCHEMA cscfeed TO ${runtimeRole}`);
  await migrationClient.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA cscfeed TO ${runtimeRole}`);
  await migrationClient.query(`GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA cscfeed TO ${runtimeRole}`);
  await migrationClient.query(`GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cscfeed TO ${runtimeRole}`);
  await migrationClient.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA cscfeed GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO ${runtimeRole}`);
  await migrationClient.query(`ALTER DEFAULT PRIVILEGES FOR ROLE ${ownerRole} IN SCHEMA cscfeed GRANT USAGE, SELECT ON SEQUENCES TO ${runtimeRole}`);
}

async function run(command, args) {
  await new Promise((resolve, reject) => {
    const child = spawn(command, args, { cwd: root, stdio: "inherit", shell: process.platform === "win32" });
    child.once("error", reject);
    child.once("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${command} ${args.join(" ")} exited with code ${code}.`));
    });
  });
}

async function main() {
  await startPostgresServiceIfStopped();
  await assertDevelopmentPortsAvailable();

  if (isTemplateUrl(process.env.DATABASE_URL) || isTemplateUrl(process.env.MIGRATION_DATABASE_URL)) {
    await bootstrapLocalDatabase();
  }
  if (!process.env.DATABASE_URL || !process.env.MIGRATION_DATABASE_URL) {
    throw new Error("DATABASE_URL and MIGRATION_DATABASE_URL must be configured in .env.");
  }

  const migrationClient = await connectClient(process.env.MIGRATION_DATABASE_URL, "migration");
  try {
    const migrationSql = await readFile(path.join(root, "database", "migrations", "001_core.sql"), "utf8");
    await migrationClient.query("BEGIN");
    try {
      await migrationClient.query(migrationSql);
      await migrationClient.query("COMMIT");
    } catch (error) {
      await migrationClient.query("ROLLBACK");
      throw error;
    }
    await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "db:migrate"]);
    await grantRuntimeAccess(migrationClient, process.env.DATABASE_URL);
  } finally {
    await migrationClient.end();
  }

  const runtimeClient = await connectClient(process.env.DATABASE_URL, "application");
  try {
    await runtimeClient.query("SELECT 1");
  } finally {
    await runtimeClient.end();
  }

  console.info("Database is ready. Starting the CSC Feed API and web app...");
  await run(process.platform === "win32" ? "npm.cmd" : "npm", ["run", "dev:stack"]);
}

main().catch((error) => {
  console.error(`Local development startup failed: ${error.message}`);
  process.exitCode = 1;
});
