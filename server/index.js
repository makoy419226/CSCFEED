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
    if (isProduction || !isDatabaseStartupError(error)) {
      console.error("CSC Feed API startup failed:", error instanceof Error ? error.message : error);
      if (client) await client.end().catch((closeError) => console.error("Could not close the database pool:", closeError));
      process.exitCode = 1;
      return;
    }
    console.error(
      "CSC Feed API starting in degraded mode; PostgreSQL-backed routes will return 503:",
      error instanceof Error ? error.message : error,
    );
  }

  const app = createApp({ db, ready: () => ready, maxUploadBytes });
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
