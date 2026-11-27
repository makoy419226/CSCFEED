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

async function start() {
  try {
    ({ db, client } = getDatabase());
    await client.query("SELECT 1");
    await bootstrapApplication({ db });
    await prepareLocalStorage();
    ready = true;
  } catch (error) {
    console.error("CSC Feed API startup failed:", error instanceof Error ? error.message : error);
    if (isProduction) {
      if (client) await client.end().catch((closeError) => console.error("Could not close the database pool:", closeError));
      process.exitCode = 1;
      return;
    }
  }

  const app = createApp({ db, ready: () => ready, maxUploadBytes });
  const host = isProduction ? "0.0.0.0" : "127.0.0.1";
  app.listen(port, host, () => {
    console.info(`CSC Feed API listening on http://${host}:${port}`);
  });
}

void start();
