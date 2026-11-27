import express from "express";
import { eq, sql } from "drizzle-orm";
import { projects, reports } from "../../src/db/schema.js";
import { asyncRoute, HttpError } from "../errors.js";
import { requireAdmin, requireIdentity } from "../identity.js";
import { projectSchema, idParamsSchema } from "../schemas.js";
import { validate } from "../validation.js";

function toProject(project) {
  return {
    id: String(project.id),
    name: project.name,
    shortName: project.name.split(/\s+/).slice(0, 2).join(" "),
    description: project.description,
    color: project.color,
    reportCount: project.reportCount ?? 0,
  };
}

export function createProjectsRouter({ db, ready }) {
  const router = express.Router();
  router.use(requireIdentity(db));

  router.get("/", asyncRoute(async (_req, res) => {
    if (!ready()) throw new HttpError(503, "Project data is not available until the database is ready.");
    const [rows, reportCounts] = await Promise.all([
      db.select().from(projects).where(eq(projects.active, true)).orderBy(projects.name),
      db.select({ projectId: reports.projectId, count: sql`count(*)::int` }).from(reports).groupBy(reports.projectId),
    ]);
    const countsByProject = new Map(reportCounts.map((item) => [String(item.projectId), Number(item.count)]));
    return res.json({ success: true, data: rows.map((row) => toProject({
      ...row,
      reportCount: countsByProject.get(String(row.id)) ?? 0,
    })) });
  }));

  router.post("/", requireAdmin, validate(projectSchema), asyncRoute(async (req, res) => {
    const [project] = await db.transaction(async (tx) => tx.insert(projects).values({
      ...req.validated.body,
      createdBy: req.identity.id,
    }).returning());
    return res.status(201).json({ success: true, data: toProject(project) });
  }));

  router.put("/:id", requireAdmin, validate(idParamsSchema, "params"), validate(projectSchema), asyncRoute(async (req, res) => {
    const [project] = await db.transaction(async (tx) => tx.update(projects)
      .set(req.validated.body)
      .where(eq(projects.id, req.validated.params.id))
      .returning());

    if (!project) throw new HttpError(404, "Project not found.");
    return res.json({ success: true, data: toProject(project) });
  }));

  router.delete("/:id", requireAdmin, validate(idParamsSchema, "params"), asyncRoute(async (req, res) => {
    let deleted;
    try {
      [deleted] = await db.delete(projects)
        .where(eq(projects.id, req.validated.params.id))
        .returning({ id: projects.id });
    } catch (error) {
      if (error?.code === "23503" || error?.cause?.code === "23503") {
        throw new HttpError(409, "Cannot delete a project that has reports.");
      }
      throw error;
    }

    if (!deleted) throw new HttpError(404, "Project not found.");
    return res.json({ success: true, data: { id: String(deleted.id) } });
  }));

  return router;
}
