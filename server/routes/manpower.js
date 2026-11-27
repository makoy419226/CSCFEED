import express from "express";
import { and, eq, inArray, ne } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { accounts, authCredentials, authSessions, projects, reports } from "../../src/db/schema.js";
import { asyncRoute, HttpError } from "../errors.js";
import { requireAdmin, requireIdentity, requireSuperUser, superUserRole } from "../identity.js";
import {
  manpowerAdminAccessSchema,
  manpowerActiveSchema,
  manpowerSchema,
  projectManagerAssignmentSchema,
  projectMembershipSchema,
  punchIdParamsSchema,
} from "../schemas.js";
import { validate } from "../validation.js";

const assignedProjects = alias(projects, "assigned_projects");
const managerProjects = alias(projects, "manager_projects");

function toPerson(account) {
  return {
    punchId: account.punchId,
    name: account.fullName,
    designation: account.designation,
    active: account.active,
    adminAccess: account.accountRole === "admin",
    projectId: account.projectId ? String(account.projectId) : null,
    projectName: account.projectName || null,
    projectManagerProjectId: account.projectManagerProjectId ? String(account.projectManagerProjectId) : null,
    projectManagerProjectName: account.projectManagerProjectName || null,
  };
}

export function createManpowerRouter({ db }) {
  const router = express.Router();
  router.use(requireIdentity(db), requireAdmin);

  router.get("/", asyncRoute(async (_req, res) => {
    const people = await db.select({
      id: accounts.id,
      punchId: accounts.punchId,
      fullName: accounts.fullName,
      designation: accounts.designation,
      active: accounts.active,
      accountRole: accounts.accountRole,
      projectId: accounts.projectId,
      projectName: assignedProjects.name,
      projectManagerProjectId: managerProjects.id,
      projectManagerProjectName: managerProjects.name,
    })
      .from(accounts)
      .leftJoin(assignedProjects, eq(assignedProjects.id, accounts.projectId))
      .leftJoin(managerProjects, eq(managerProjects.managerId, accounts.id))
      .where(and(inArray(accounts.accountRole, ["employee", "admin"]), ne(accounts.punchId, "0000")))
      .orderBy(accounts.fullName);
    return res.json({ success: true, data: people.map(toPerson) });
  }));

  router.patch("/:punchId/project", requireSuperUser, validate(punchIdParamsSchema, "params"), validate(projectMembershipSchema), asyncRoute(async (req, res) => {
    const result = await db.transaction(async (tx) => {
      const [target] = await tx.select({
        id: accounts.id,
        punchId: accounts.punchId,
        fullName: accounts.fullName,
        designation: accounts.designation,
        accountRole: accounts.accountRole,
        active: accounts.active,
        projectId: accounts.projectId,
      })
        .from(accounts)
        .where(eq(accounts.punchId, req.validated.params.punchId))
        .for("update");

      if (!target || target.punchId === "0000" || target.accountRole === superUserRole) {
        throw new HttpError(404, "Employee account not found.");
      }
      if (!["employee", "admin"].includes(target.accountRole)) {
        throw new HttpError(409, "This account cannot be assigned to a project.");
      }

      let destination = null;
      if (req.validated.body.projectId !== null) {
        [destination] = await tx.select({
          id: projects.id,
          name: projects.name,
        })
          .from(projects)
          .where(and(
            eq(projects.id, req.validated.body.projectId),
            eq(projects.active, true),
          ))
          .for("update");

        if (!destination) throw new HttpError(404, "Active project not found.");
      }

      const nextProjectId = destination?.id ?? null;
      if (Number(target.projectId) !== Number(nextProjectId)) {
        await tx.update(accounts)
          .set({ projectId: nextProjectId })
          .where(eq(accounts.id, target.id));
      }

      const [managerProject] = await tx.select({
        projectManagerProjectId: projects.id,
        projectManagerProjectName: projects.name,
      })
        .from(projects)
        .where(eq(projects.managerId, target.id))
        .limit(1);

      return toPerson({
        ...target,
        projectId: nextProjectId,
        projectName: destination?.name || null,
        ...managerProject,
      });
    });

    return res.json({ success: true, data: result });
  }));

  router.patch("/:punchId/project-manager", requireSuperUser, validate(punchIdParamsSchema, "params"), validate(projectManagerAssignmentSchema), asyncRoute(async (req, res) => {
    try {
      const result = await db.transaction(async (tx) => {
        const [target] = await tx.select({
          id: accounts.id,
          punchId: accounts.punchId,
          fullName: accounts.fullName,
          designation: accounts.designation,
          accountRole: accounts.accountRole,
          active: accounts.active,
        })
          .from(accounts)
          .where(eq(accounts.punchId, req.validated.params.punchId))
          .for("update");

        if (!target || target.punchId === "0000" || target.accountRole === superUserRole) {
          throw new HttpError(404, "Employee account not found.");
        }

        const [currentAssignment] = await tx.select({
          id: projects.id,
          name: projects.name,
        })
          .from(projects)
          .where(eq(projects.managerId, target.id))
          .for("update");

        if (req.validated.body.projectId === null) {
          if (currentAssignment) {
            await tx.update(projects)
              .set({ managerId: null })
              .where(eq(projects.id, currentAssignment.id));
          }
          return { ...target, projectManagerProjectId: null, projectManagerProjectName: null };
        }

        if (!target.active || target.accountRole !== "employee") {
          throw new HttpError(409, "Only active employee accounts can be project managers.");
        }

        const [destination] = await tx.select({
          id: projects.id,
          name: projects.name,
          managerId: projects.managerId,
        })
          .from(projects)
          .where(and(
            eq(projects.id, req.validated.body.projectId),
            eq(projects.active, true),
          ))
          .for("update");

        if (!destination) throw new HttpError(404, "Active project not found.");
        if (destination.managerId && Number(destination.managerId) !== Number(target.id)) {
          throw new HttpError(409, "This project already has an assigned manager.");
        }

        if (currentAssignment && Number(currentAssignment.id) !== Number(destination.id)) {
          await tx.update(projects)
            .set({ managerId: null })
            .where(eq(projects.id, currentAssignment.id));
        }
        if (!currentAssignment || Number(currentAssignment.id) !== Number(destination.id)) {
          await tx.update(projects)
            .set({ managerId: target.id })
            .where(eq(projects.id, destination.id));
        }

        return {
          ...target,
          projectManagerProjectId: destination.id,
          projectManagerProjectName: destination.name,
        };
      });

      return res.json({ success: true, data: toPerson(result) });
    } catch (error) {
      if (error?.code === "23505" || error?.cause?.code === "23505") {
        throw new HttpError(409, "The project or employee already has an assigned manager.");
      }
      throw error;
    }
  }));

  router.delete("/:punchId", requireSuperUser, validate(punchIdParamsSchema, "params"), asyncRoute(async (req, res) => {
    const result = await db.transaction(async (tx) => {
      const [target] = await tx.select({
        id: accounts.id,
        punchId: accounts.punchId,
        fullName: accounts.fullName,
        accountRole: accounts.accountRole,
      })
        .from(accounts)
        .where(eq(accounts.punchId, req.validated.params.punchId))
        .for("update");

      if (!target) throw new HttpError(404, "Manpower account not found.");
      if (target.punchId === "0000" || target.accountRole === superUserRole) {
        throw new HttpError(403, "The Super User account cannot be deleted.");
      }
      if (!["employee", "admin"].includes(target.accountRole)) {
        throw new HttpError(409, "This account cannot be deleted from manpower.");
      }

      const reportRows = await tx.select({ id: reports.id })
        .from(reports)
        .where(eq(reports.uploadedBy, target.id))
        .for("update");

      await tx.delete(authSessions).where(eq(authSessions.accountId, target.id));
      await tx.delete(authCredentials).where(eq(authCredentials.accountId, target.id));
      const [deleted] = await tx.delete(accounts)
        .where(eq(accounts.id, target.id))
        .returning({ id: accounts.id });
      if (!deleted) throw new HttpError(409, "This account changed while the request was being processed.");

      return {
        name: target.fullName,
        punchId: target.punchId,
        preservedReportCount: reportRows.length,
      };
    });

    return res.json({ success: true, data: result });
  }));

  router.post("/", validate(manpowerSchema), asyncRoute(async (req, res) => {
    const [account] = await db.transaction(async (tx) => tx.insert(accounts).values({
      punchId: req.validated.body.punchId,
      fullName: req.validated.body.name,
      designation: req.validated.body.designation,
      accountRole: "employee",
      active: true,
    }).returning());
    return res.status(201).json({ success: true, data: toPerson(account) });
  }));

  router.patch("/:punchId/admin-access", requireSuperUser, validate(punchIdParamsSchema, "params"), validate(manpowerAdminAccessSchema), asyncRoute(async (req, res) => {
    const punchId = req.validated.params.punchId;
    if (punchId === "0000") throw new HttpError(403, "The Super User account cannot be changed.");

    const [target] = await db.select({
      id: accounts.id,
      punchId: accounts.punchId,
      accountRole: accounts.accountRole,
      active: accounts.active,
    })
      .from(accounts)
      .where(eq(accounts.punchId, punchId))
      .limit(1);

    if (!target) throw new HttpError(404, "Employee account not found.");
    if (target.accountRole === superUserRole) {
      throw new HttpError(403, "The Super User account cannot be changed.");
    }
    if (req.validated.body.adminAccess && !target.active) {
      throw new HttpError(409, "Activate this account before granting admin access.");
    }
    if (!["employee", "admin"].includes(target.accountRole)) {
      throw new HttpError(409, "This account cannot be assigned admin access.");
    }

    const [account] = await db.update(accounts)
      .set({ accountRole: req.validated.body.adminAccess ? "admin" : "employee" })
      .where(and(
        eq(accounts.id, target.id),
        inArray(accounts.accountRole, ["employee", "admin"]),
        ne(accounts.punchId, "0000"),
        ...(req.validated.body.adminAccess ? [eq(accounts.active, true)] : []),
      ))
      .returning();

    if (!account) throw new HttpError(409, "This account changed while the request was being processed.");
    return res.json({ success: true, data: toPerson(account) });
  }));

  router.put("/:punchId", validate(punchIdParamsSchema, "params"), validate(manpowerSchema), asyncRoute(async (req, res) => {
    const [account] = await db.transaction(async (tx) => tx.update(accounts)
      .set({
        punchId: req.validated.body.punchId,
        fullName: req.validated.body.name,
        designation: req.validated.body.designation,
      })
      .where(and(
        eq(accounts.punchId, req.validated.params.punchId),
        eq(accounts.accountRole, "employee"),
      ))
      .returning());

    if (!account) throw new HttpError(404, "Employee account not found.");
    const [[assignedProject], [managerAssignment]] = await Promise.all([
      db.select({ projectName: projects.name })
        .from(projects)
        .where(eq(projects.id, account.projectId))
        .limit(1),
      db.select({
        projectManagerProjectId: projects.id,
        projectManagerProjectName: projects.name,
      })
        .from(projects)
        .where(eq(projects.managerId, account.id))
        .limit(1),
    ]);
    return res.json({
      success: true,
      data: toPerson({ ...account, ...assignedProject, ...managerAssignment }),
    });
  }));

  router.patch("/:punchId/active", validate(punchIdParamsSchema, "params"), validate(manpowerActiveSchema), asyncRoute(async (req, res) => {
    const [account] = await db.transaction(async (tx) => tx.update(accounts)
      .set({ active: req.validated.body.active })
      .where(and(
        eq(accounts.punchId, req.validated.params.punchId),
        eq(accounts.accountRole, "employee"),
      ))
      .returning());

    if (!account) throw new HttpError(404, "Employee account not found.");
    return res.json({ success: true, data: toPerson(account) });
  }));

  return router;
}
