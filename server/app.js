import express from "express";
import { existsSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createAuthRouter } from "./routes/auth.js";
import { createManpowerRouter } from "./routes/manpower.js";
import { createProjectsRouter } from "./routes/projects.js";
import { createReportsRouter } from "./routes/reports.js";
import { handleError, HttpError } from "./errors.js";

export function createApp({ db, ready, maxUploadBytes }) {
  const app = express();
  const isProduction = process.env.NODE_ENV === "production";

  app.disable("x-powered-by");
  app.set("trust proxy", isProduction ? 1 : false);
  app.use("/api", (_req, res, next) => {
    res.setHeader("Cache-Control", "no-store");
    next();
  });
  app.use(express.json({ limit: "10kb" }));

  app.get("/api/health", (_req, res) => {
    res.status(ready() ? 200 : 503).json({ ready: ready() });
  });
  app.get("/api/config", (_req, res) => {
    res.json({ success: true, maxUploadBytes });
  });
  app.use("/api/auth", createAuthRouter({ db, ready }));

  const requireReady = (_req, _res, next) => {
    if (!ready()) return next(new HttpError(503, "Application data is unavailable until PostgreSQL and migrations are ready."));
    return next();
  };
  app.use("/api/projects", requireReady, createProjectsRouter({ db, ready }));
  app.use("/api/manpower", requireReady, createManpowerRouter({ db }));
  app.use("/api/reports", requireReady, createReportsRouter({ db, maxUploadBytes }));
  app.use("/api", (_req, res) => {
    res.status(404).json({ success: false, message: "API route not found." });
  });
  app.use(handleError);

  if (isProduction) {
    const distPath = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../dist");
    if (existsSync(distPath)) {
      app.use(express.static(distPath));
      app.get("*", (_req, res) => res.sendFile(path.join(distPath, "index.html")));
    }
  }

  return app;
}
