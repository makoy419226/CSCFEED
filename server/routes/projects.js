import express from "express";
import { and, eq, ne, sql } from "drizzle-orm";
import { accounts, projects, reports } from "../../src/db/schema.js";
import { asyncRoute, HttpError } from "../errors.js";
import { hasAdminAccess, requireAdmin, requireIdentity, requireSuperUser, superUserRole } from "../identity.js";
import { projectManagerAppointmentSchema, projectSchema, idParamsSchema } from "../schemas.js";
import { validate } from "../validation.js";

function toProject(project) {
  return {
    id: String(project.id),
    name: project.name,
    shortName: project.name.split(/\s+/).slice(0, 2).join(" "),
    description: project.description,
    color: project.color,
    reportCount: project.reportCount ?? 0,
    managerName: project.managerName || null,
    managerPunchId: project.managerPunchId || null,
  };
}

export function createProjectsRouter({ db, ready }) {
  const router = express.Router();
  router.use(requireIdentity(db));

  router.get("/", asyncRoute(async (req, res) => {
    if (!ready()) throw new HttpError(503, "Project data is not available until the database is ready.");
    const filters = [eq(projects.active, true)];
    if (!hasAdminAccess(req.identity.role) && req.identity.projectManagerProjectId) {
      filters.push(eq(projects.id, Number(req.identity.projectManagerProjectId)));
    }
    const [rows, reportCounts] = await Promise.all([
      db.select({
        id: projects.id,
        name: projects.name,
        description: projects.description,
        color: projects.color,
        managerName: accounts.fullName,
        managerPunchId: accounts.punchId,
      })
        .from(projects)
        .leftJoin(accounts, eq(accounts.id, projects.managerId))
        .where(and(...filters))
        .orderBy(projects.name),
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

  router.patch("/:id/manager", requireSuperUser, validate(idParamsSchema, "params"), validate(projectManagerAppointmentSchema), asyncRoute(async (req, res) => {
    const projectId = req.validated.params.id;
    const { punchId } = req.validated.body;
    try {
      const result = await db.transaction(async (tx) => {
        const [project] = await tx.select({
          id: projects.id,
          name: projects.name,
          description: projects.description,
          color: projects.color,
          managerId: projects.managerId,
        })
          .from(projects)
          .where(and(eq(projects.id, projectId), eq(projects.active, true)))
          .for("update");
        if (!project) throw new HttpError(404, "Active project not found.");

        if (punchId === null) {
          if (project.managerId) {
            await tx.update(projects).set({ managerId: null }).where(eq(projects.id, project.id));
          }
          return { project: { ...project, managerName: null, managerPunchId: null }, previousProjectId: null };
        }

        const [manager] = await tx.select({
          id: accounts.id,
          punchId: accounts.punchId,
          fullName: accounts.fullName,
          accountRole: accounts.accountRole,
          active: accounts.active,
        })
          .from(accounts)
          .where(eq(accounts.punchId, punchId))
          .for("update");
        if (!manager || manager.punchId === "0000" || manager.accountRole === superUserRole) {
          throw new HttpError(404, "Employee account not found.");
        }
        if (!manager.active || manager.accountRole !== "employee") {
          throw new HttpError(409, "Only active employee accounts can be project managers.");
        }

        // A person manages at most one project: move them off any previous one.
        const [previous] = await tx.select({ id: projects.id })
          .from(projects)
          .where(and(eq(projects.managerId, manager.id), ne(projects.id, project.id)))
          .for("update");
        if (previous) {
          await tx.update(projects).set({ managerId: null }).where(eq(projects.id, previous.id));
        }
        if (Number(project.managerId) !== Number(manager.id)) {
          await tx.update(projects).set({ managerId: manager.id }).where(eq(projects.id, project.id));
        }

        return {
          project: { ...project, managerName: manager.fullName, managerPunchId: manager.punchId },
          previousProjectId: previous ? String(previous.id) : null,
        };
      });

      return res.json({
        success: true,
        data: { ...toProject(result.project), previousProjectId: result.previousProjectId },
      });
    } catch (error) {
      if (error?.code === "23505" || error?.cause?.code === "23505") {
        throw new HttpError(409, "This employee is already assigned to manage another project.");
      }
      throw error;
    }
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
