import "dotenv/config";
import { createApp } from "./app.js";
import { bootstrapApplication } from "./bootstrap.js";
import { getDatabase } from "./db.js";
import { maxUploadBytes, prepareLocalStorage } from "./storage/local.js";

const isProduction = process.env.NODE_ENV === "production";
const port = Number(process.env.PORT || 5001);
let db;
let client;
let ready = false;
let startupError = null;

function isDatabaseStartupError(error) {
  if (error?.message === "DATABASE_URL is not configured.") return true;
  return [
    "28P01",
    "3D000",
    "42P01",
    "42501",
    "3F000",
    "ECONNREFUSED",
    "ENOTFOUND",
    "ETIMEDOUT",
  ].includes(error?.code);
}

async function start() {
  try {
    ({ db, client } = getDatabase());
    await client.query("SELECT 1");
    await bootstrapApplication({ db });
    await prepareLocalStorage();
    ready = true;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (isProduction) {
      console.error("CSC Feed API startup failed:", message);
      if (client) await client.end().catch((closeError) => console.error("Could not close the database pool:", closeError));
      process.exitCode = 1;
      return;
    }
    // In development keep listening so the login screen can show the real reason
    // instead of a generic "service unavailable".
    startupError = `${message}${error?.code ? ` (code ${error.code})` : ""}`;
    console.error(
      isDatabaseStartupError(error)
        ? "CSC Feed API starting in degraded mode; PostgreSQL-backed routes will return 503:"
        : "CSC Feed API startup failed; running in degraded mode so the error is visible at sign-in:",
      startupError,
    );
    if (!isDatabaseStartupError(error) && error instanceof Error && error.stack) console.error(error.stack);
  }

  const app = createApp({ db, ready: () => ready, startupError: () => startupError, maxUploadBytes });
  const host = "0.0.0.0";
  const server = app.listen(port, host, () => {
    console.info(`CSC Feed API listening on http://${host}:${port}`);
  });
  server.on("error", async (error) => {
    if (error.code === "EADDRINUSE") {
      console.error(`CSC Feed API could not listen on ${host}:${port}: the port is already in use.`);
    } else {
      console.error("CSC Feed API failed to listen:", error.message);
    }
    if (client) {
      await client.end().catch((closeError) => console.error("Could not close the database pool:", closeError));
    }
    process.exitCode = 1;
  });
}

void start();
