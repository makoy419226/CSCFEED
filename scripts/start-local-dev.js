import { randomBytes } from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import { connect, createServer } from "node:net";
import { userInfo } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createInterface } from "node:readline";
import { config } from "dotenv";
import pg from "pg";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const envPath = path.join(root, ".env");
const { Client } = pg;
const defaultPostgresAdminUsername = process.platform === "darwin" ? userInfo().username : "postgres";
const skipDatabaseStartup = process.argv.includes("--skip-database");
// --prepare-only: start PostgreSQL, create/repair the database, run migrations, then exit
// without starting the dev servers (used by scripts/start-local.js).
const prepareOnly = process.argv.includes("--prepare-only");
process.chdir(root);
config({ path: envPath });

function isTemplateUrl(value) {
  if (!value) return true;
  return decodeURIComponent(new URL(value).password) === "change-me";
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
  // On Windows a test bind to 127.0.0.1 can succeed even while another process
  // listens on 0.0.0.0, so also try connecting: if anything answers, it is taken.
  for (const host of ["127.0.0.1", "::1"]) {
    const answered = await new Promise((resolve) => {
      const socket = connect({ port, host });
      socket.setTimeout(1000);
      socket.once("connect", () => { socket.destroy(); resolve(true); });
      socket.once("timeout", () => { socket.destroy(); resolve(false); });
      socket.once("error", () => resolve(false));
    });
    if (answered) {
      throw new Error(`${service} port ${port} is already in use (an earlier dev server may still be running). Stop it before starting another copy.`);
    }
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
  await assertPortAvailable(apiPort, "API", ["127.0.0.1", "::"]);
  await assertPortAvailable(5173, "Web", ["127.0.0.1", "::1", "::"]);
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
  const loopbackHosts = ["127.0.0.1", "localhost", "::1", "[::1]"];
  const databaseUrl = [process.env.MIGRATION_DATABASE_URL, process.env.DATABASE_URL]
    .find((value) => {
      if (!value) return false;
      try {
        return loopbackHosts.includes(new URL(value).hostname);
      } catch {
        return false;
      }
    });
  if (!databaseUrl) return;

  const databasePort = Number(new URL(databaseUrl).port || 5432);
  if (!Number.isInteger(databasePort) || databasePort < 1 || databasePort > 65535) {
    throw new Error("The local PostgreSQL URL has an invalid port.");
  }

  const command = [
    `$port = ${databasePort}`,
    "$services = @(Get-CimInstance Win32_Service -Filter \"Name like 'postgresql%'\" -ErrorAction SilentlyContinue)",
    "if ($services.Count -eq 0) { Write-Error 'No PostgreSQL Windows service was found. On a new PC, run npm run setup first.'; exit 2 }",
    "$matching = @()",
    "foreach ($service in $services) {",
    "  if ($service.PathName -match '-D\\s+\"([^\"]+)\"') {",
    "    $configPath = Join-Path $Matches[1] 'postgresql.conf'",
    "  } else { continue }",
    "  $configuredPort = 5432",
    "  if (Test-Path $configPath) {",
    "    $portLine = Select-String -Path $configPath -Pattern '^\\s*port\\s*=\\s*(\\d+)' | Select-Object -First 1",
    "    if ($portLine) { $configuredPort = [int]$portLine.Matches[0].Groups[1].Value }",
    "  }",
    "  if ($configuredPort -eq $port) { $matching += $service }",
    "}",
    "if ($matching.Count -eq 0) { Write-Error \"No PostgreSQL service is configured for port $port. Run npm run setup or check the database port in .env.\"; exit 3 }",
    "$running = @($matching | Where-Object { $_.State -eq 'Running' })",
    "if ($running.Count -eq 1) { Write-Output ('PostgreSQL service is running: ' + $running[0].Name); exit 0 }",
    "if ($running.Count -gt 1 -or $matching.Count -gt 1) { Write-Error \"Multiple PostgreSQL services match port $port. Configure only one service for this port.\"; exit 4 }",
    "try { Start-Service -Name $matching[0].Name -ErrorAction Stop } catch { Write-Error \"Could not start $($matching[0].Name): $($_.Exception.Message)\"; exit 5 }",
    "Write-Output ('Started PostgreSQL service: ' + $matching[0].Name)",
  ].join("; ");
  const result = spawnSync("powershell.exe", ["-NoProfile", "-Command", command], {
    encoding: "utf8",
    windowsHide: true,
  });
  if (result.error) {
    throw new Error(`Could not check PostgreSQL service on port ${databasePort}: ${result.error.message}`);
  }
  if (result.status !== 0) {
    const detail = [result.stderr, result.stdout].filter(Boolean).join(" ").replace(/\s+/g, " ").trim();
    throw new Error(detail || `Could not start PostgreSQL service on port ${databasePort}. Run npm run setup or start the matching service manually.`);
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
      const credentialError = new Error(`${label} credentials were rejected. Check the local .env connection settings.`);
      credentialError.code = error.code;
      throw credentialError;
    }
    if (error.code === "3D000") {
      throw new Error(`${label} database does not exist. Use the first-run setup with an unused local database, or correct .env.`);
    }
    if (error.code === "ECONNREFUSED" || error.code === "ENOTFOUND") {
      const { hostname, port } = new URL(url);
      if (Number(port) === Number(process.env.PORT || 5001)) {
        throw new Error(`Could not connect to PostgreSQL for ${label} at ${hostname}:${port}. Port ${port} is the CSC Feed API port; PostgreSQL usually listens on 5432. Check the PostgreSQL host and port, then retry.`);
      }
      throw new Error(`Could not connect to PostgreSQL for ${label} at ${hostname}:${port} (${error.code}). Confirm the PostgreSQL service is listening at this address, then retry.`);
    }
    throw new Error(`Could not connect to PostgreSQL for ${label}: ${error.message}`);
  }
}

async function recoverLocalDatabaseCredentials() {
  const migrationUrl = new URL(process.env.MIGRATION_DATABASE_URL);
  const databaseUrl = new URL(process.env.DATABASE_URL);
  const loopbackHosts = ["127.0.0.1", "localhost", "::1", "[::1]"];
  if (
    !loopbackHosts.includes(migrationUrl.hostname) ||
    migrationUrl.hostname !== databaseUrl.hostname ||
    migrationUrl.port !== databaseUrl.port ||
    migrationUrl.pathname !== databaseUrl.pathname ||
    decodeURIComponent(migrationUrl.username) !== "cscfeed_owner" ||
    decodeURIComponent(databaseUrl.username) !== "cscfeed_app" ||
    migrationUrl.pathname !== "/cscfeed"
  ) {
    throw new Error("Automatic credential recovery is limited to the local cscfeed database and its dedicated roles. Correct .env manually.");
  }
  if (!process.stdin.isTTY) {
    throw new Error("Run npm run dev in an interactive terminal to recover PostgreSQL credentials.");
  }

  const confirmation = await askText(
    "Rotate the local cscfeed_owner and cscfeed_app passwords? Database contents will not be changed (y/N)",
    "N",
  );
  if (!/^y(es)?$/i.test(confirmation)) {
    throw new Error("PostgreSQL credential recovery was not confirmed. Correct the connection passwords in .env and retry.");
  }

  console.info("Credential recovery requires a PostgreSQL administrator for this local server.");
  const adminUser = await askText("PostgreSQL administrator username", defaultPostgresAdminUsername);
  const adminPassword = await askSecret("PostgreSQL administrator password");
  if (!adminPassword) throw new Error("The PostgreSQL administrator password cannot be empty.");

  const adminUrl = new URL(migrationUrl);
  adminUrl.username = adminUser;
  adminUrl.password = adminPassword;
  adminUrl.pathname = "/postgres";
  adminUrl.search = "";
  adminUrl.hash = "";
  const admin = await connectClient(adminUrl.toString(), "PostgreSQL administrator");
  try {
    const existingRoles = await admin.query(
      "SELECT rolname FROM pg_roles WHERE rolname = ANY($1::text[])",
      [["cscfeed_owner", "cscfeed_app"]],
    );
    if (existingRoles.rowCount !== 2) {
      throw new Error("The expected cscfeed_owner and cscfeed_app roles were not both found; no passwords were changed.");
    }
    const existingDatabase = await admin.query(
      "SELECT 1 FROM pg_database WHERE datname = $1",
      ["cscfeed"],
    );
    if (!existingDatabase.rowCount) {
      throw new Error("The cscfeed database was not found; no passwords were changed.");
    }

    await rotateLocalRolePasswords(admin, migrationUrl, databaseUrl);
  } finally {
    await admin.end();
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

async function ensureLocalPasswordEncryptionKey() {
  if (/^[\da-f]{64}$/i.test(process.env.PASSWORD_ENCRYPTION_KEY || "")) return;
  const key = randomBytes(32).toString("hex");
  let contents = "";
  try {
    contents = await readFile(envPath, "utf8");
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
  const newline = contents.includes("\r\n") ? "\r\n" : "\n";
  const lines = contents ? contents.split(/\r?\n/) : [];
  if (lines[lines.length - 1] === "") lines.pop();
  const index = lines.findIndex((line) => /^\s*PASSWORD_ENCRYPTION_KEY\s*=/.test(line));
  const setting = `PASSWORD_ENCRYPTION_KEY=${key}`;
  if (index >= 0) lines[index] = setting;
  else lines.push(setting);
  await writeFile(envPath, `${lines.join(newline)}${newline}`, { encoding: "utf8", mode: 0o600 });
  process.env.PASSWORD_ENCRYPTION_KEY = key;
  console.info("Generated a password encryption key and saved it to the Git-ignored .env.");
}

async function rotateLocalRolePasswords(admin, migrationUrl, databaseUrl) {
  const roles = [
    { name: "cscfeed_owner", url: migrationUrl, password: randomBytes(32).toString("hex") },
    { name: "cscfeed_app", url: databaseUrl, password: randomBytes(32).toString("hex") },
  ];
  await admin.query("BEGIN");
  try {
    for (const role of roles) {
      await admin.query(`ALTER ROLE ${quoteIdentifier(role.name)} WITH PASSWORD '${role.password}'`);
    }
    await admin.query("COMMIT");
  } catch (error) {
    await admin.query("ROLLBACK");
    throw error;
  }

  for (const role of roles) role.url.password = role.password;
  const nextMigrationUrl = migrationUrl.toString();
  const nextDatabaseUrl = databaseUrl.toString();
  await saveDatabaseUrls(nextDatabaseUrl, nextMigrationUrl);
  process.env.MIGRATION_DATABASE_URL = nextMigrationUrl;
  process.env.DATABASE_URL = nextDatabaseUrl;
  console.info("Updated the local PostgreSQL role passwords and saved the new URLs to the Git-ignored .env.");
}

async function bootstrapLocalDatabase() {
  if (!process.stdin.isTTY) {
    throw new Error("Run npm run dev in an interactive terminal to set up or recover local PostgreSQL.");
  }
  console.info("Local PostgreSQL setup: create a new cscfeed database, or recover its existing dedicated roles.");
  const host = "127.0.0.1";
  const port = 5432;
  console.info(`Using local PostgreSQL at ${host}:${port} (5001 is the CSC Feed API port).`);
  const adminUser = await askText("PostgreSQL administrator username", defaultPostgresAdminUsername);
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
    const database = await admin.query("SELECT 1 FROM pg_database WHERE datname = $1", ["cscfeed"]);
    if (roles.rowCount || database.rowCount) {
      if (roles.rowCount !== 2 || !database.rowCount) {
        throw new Error("An incomplete cscfeed setup already exists. It will not be modified; configure its existing roles and database manually.");
      }
      const confirmation = await askText(
        "The local cscfeed database and roles already exist. Rotate their passwords without changing database contents (y/N)",
        "N",
      );
      if (!/^y(es)?$/i.test(confirmation)) {
        throw new Error("PostgreSQL credential recovery was not confirmed. Correct the connection passwords in .env and retry.");
      }
      await rotateLocalRolePasswords(
        admin,
        new URL(connectionUrl({
          user: "cscfeed_owner",
          password: "",
          host,
          port,
          database: "cscfeed",
        })),
        new URL(connectionUrl({
          user: "cscfeed_app",
          password: "",
          host,
          port,
          database: "cscfeed",
        })),
      );
      return;
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

async function runNpm(args) {
  const npmCliPath = process.env.npm_execpath;
  if (!npmCliPath) {
    throw new Error("Could not locate the npm CLI. Start this script with `npm run dev`.");
  }

  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [npmCliPath, ...args], { cwd: root, stdio: "inherit" });
    child.once("error", reject);
    child.once("close", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`npm ${args.join(" ")} exited with code ${code ?? signal}.`));
    });
  });
}

async function main() {
  if (skipDatabaseStartup) {
    await assertDevelopmentPortsAvailable();
    console.info("Skipping PostgreSQL checks and migrations. Starting the development stack; database-backed API routes may be unavailable.");
    await runNpm(["run", "dev:stack"]);
    return;
  }

  await ensureLocalPasswordEncryptionKey();

  await startPostgresServiceIfStopped();
  await assertDevelopmentPortsAvailable();

  if (isTemplateUrl(process.env.DATABASE_URL) || isTemplateUrl(process.env.MIGRATION_DATABASE_URL)) {
    await bootstrapLocalDatabase();
  }
  if (!process.env.DATABASE_URL || !process.env.MIGRATION_DATABASE_URL) {
    throw new Error("DATABASE_URL and MIGRATION_DATABASE_URL must be configured in .env.");
  }

  let migrationClient;
  try {
    migrationClient = await connectClient(process.env.MIGRATION_DATABASE_URL, "migration");
  } catch (error) {
    if (error.code !== "28P01") throw error;
    await recoverLocalDatabaseCredentials();
    migrationClient = await connectClient(process.env.MIGRATION_DATABASE_URL, "migration");
  }
  try {
    const migrationSql = await Promise.all([
      "001_core.sql",
      "002_admin_roles.sql",
      "003_account_and_report_deletion.sql",
      "004_project_managers.sql",
      "005_project_manager_appointments.sql",
      "006_manpower_transfer_log.sql",
      "007_delegated_admin_access.sql",
      "008_recoverable_password_view.sql",
    ].map((fileName) => readFile(path.join(root, "database", "migrations", fileName), "utf8")));
    await migrationClient.query("BEGIN");
    try {
      for (const migration of migrationSql) await migrationClient.query(migration);
      await migrationClient.query("COMMIT");
    } catch (error) {
      await migrationClient.query("ROLLBACK");
      throw error;
    }
    await runNpm(["run", "db:migrate"]);
    await grantRuntimeAccess(migrationClient, process.env.DATABASE_URL);
  } finally {
    await migrationClient.end();
  }

  let runtimeClient;
  try {
    runtimeClient = await connectClient(process.env.DATABASE_URL, "application");
  } catch (error) {
    if (error.code !== "28P01") throw error;
    await recoverLocalDatabaseCredentials();
    runtimeClient = await connectClient(process.env.DATABASE_URL, "application");
  }
  try {
    await runtimeClient.query("SELECT 1");
  } finally {
    await runtimeClient.end();
  }

  if (prepareOnly) {
    console.info("Database is ready.");
    return;
  }
  console.info("Database is ready. Starting the CSC Feed API and web app...");
  await runNpm(["run", "dev:stack"]);
}

main().catch((error) => {
  console.error(`Local development startup failed: ${error.message}`);
  process.exitCode = 1;
});
