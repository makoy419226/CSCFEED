import express from "express";
import bcrypt from "bcryptjs";
import rateLimit from "express-rate-limit";
import { and, eq, inArray, ne, or } from "drizzle-orm";
import { alias } from "drizzle-orm/pg-core";
import { accounts, authCredentials, authSessions, projects, reports } from "../../src/db/schema.js";
import { asyncRoute, HttpError } from "../errors.js";
import { requireAdmin, requireIdentity, requireSuperUser, superUserRole } from "../identity.js";
import {
  manpowerAdminAccessSchema,
  manpowerActiveSchema,
  manpowerPasswordSchema,
  manpowerProjectManagerAccessSchema,
  manpowerSchema,
  projectManagerAssignmentSchema,
  projectManagerAssignmentsSchema,
  projectMembershipSchema,
  punchIdParamsSchema,
} from "../schemas.js";
import { validate } from "../validation.js";

const assignedProjects = alias(projects, "assigned_projects");
const managerProjects = alias(projects, "manager_projects");
const passwordManagementLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

function toPerson(account) {
  return {
    punchId: account.punchId,
    name: account.fullName,
    designation: account.designation,
    active: account.active,
    adminAccess: account.accountRole === "admin",
    isProjectManager: account.accountRole === "project_manager",
    passwordSet: Boolean(account.passwordSet),
    projectId: account.projectId ? String(account.projectId) : null,
    projectName: account.projectName || null,
    projectManagerProjects: (account.projectManagerProjects || []).map((project) => ({
      id: String(project.id),
      name: project.name,
    })),
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
      passwordSet: authCredentials.passwordHash,
      projectId: accounts.projectId,
      projectName: assignedProjects.name,
    })
      .from(accounts)
      .leftJoin(authCredentials, eq(authCredentials.accountId, accounts.id))
      .leftJoin(assignedProjects, eq(assignedProjects.id, accounts.projectId))
      .where(and(inArray(accounts.accountRole, ["employee", "admin", "project_manager"]), ne(accounts.punchId, "0000")))
      .orderBy(accounts.fullName);
    const managerAssignments = people.length
      ? await db.select({
        accountId: managerProjects.managerId,
        id: managerProjects.id,
        name: managerProjects.name,
      })
        .from(managerProjects)
        .where(inArray(managerProjects.managerId, people.map(({ id }) => id)))
        .orderBy(managerProjects.name)
      : [];
    const assignmentsByAccount = new Map();
    for (const assignment of managerAssignments) {
      const assignments = assignmentsByAccount.get(assignment.accountId) || [];
      assignments.push({ id: assignment.id, name: assignment.name });
      assignmentsByAccount.set(assignment.accountId, assignments);
    }
    return res.json({
      success: true,
      data: people.map((person) => toPerson({
        ...person,
        projectManagerProjects: assignmentsByAccount.get(person.id) || [],
      })),
    });
  }));

  router.patch("/:punchId/password", requireSuperUser, passwordManagementLimiter, validate(punchIdParamsSchema, "params"), validate(manpowerPasswordSchema), asyncRoute(async (req, res) => {
    const result = await db.transaction(async (tx) => {
      const [target] = await tx.select({
        id: accounts.id,
        punchId: accounts.punchId,
        accountRole: accounts.accountRole,
      })
        .from(accounts)
        .where(eq(accounts.punchId, req.validated.params.punchId))
        .for("update");

      if (!target || !["employee", "project_manager"].includes(target.accountRole)) {
        throw new HttpError(404, "Employee or Project Manager account not found.");
      }

      const passwordHash = await bcrypt.hash(req.validated.body.newPassword, 12);
      await tx.insert(authCredentials)
        .values({ accountId: target.id, username: target.punchId, passwordHash })
        .onConflictDoUpdate({
          target: authCredentials.accountId,
          set: { username: target.punchId, passwordHash },
        });
      await tx.delete(authSessions).where(eq(authSessions.accountId, target.id));
      return { punchId: target.punchId };
    });

    return res.json({ success: true, data: { ...result, passwordSet: true } });
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
      if (!["employee", "admin", "project_manager"].includes(target.accountRole)) {
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

      const projectManagerProjects = target.accountRole === "project_manager"
        ? await tx.select({ id: projects.id, name: projects.name })
          .from(projects)
          .where(eq(projects.managerId, target.id))
          .orderBy(projects.name)
        : [];

      return toPerson({
        ...target,
        projectId: nextProjectId,
        projectName: destination?.name || null,
        projectManagerProjects,
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
        if (!target.active || target.accountRole !== "project_manager") {
          throw new HttpError(409, "Only active appointed Project Managers can be assigned to projects.");
        }

        if (req.validated.body.projectId === null) {
          await tx.update(projects)
            .set({ managerId: null })
            .where(eq(projects.managerId, target.id));
        } else {
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
          if (Number(destination.managerId) !== Number(target.id)) {
            await tx.update(projects)
              .set({ managerId: target.id })
              .where(eq(projects.id, destination.id));
          }
        }

        const projectManagerProjects = await tx.select({
          id: projects.id,
          name: projects.name,
        })
          .from(projects)
          .where(eq(projects.managerId, target.id))
          .orderBy(projects.name);
        return { ...target, projectManagerProjects };
      });

      return res.json({ success: true, data: toPerson(result) });
    } catch (error) {
      if (error?.code === "23505" || error?.cause?.code === "23505") {
        throw new HttpError(409, "This project already has an assigned manager.");
      }
      throw error;
    }
  }));

  router.put("/:punchId/project-manager-assignments", requireSuperUser, validate(punchIdParamsSchema, "params"), validate(projectManagerAssignmentsSchema), asyncRoute(async (req, res) => {
    const projectIds = req.validated.body.projectIds;
    const projectIdSet = new Set(projectIds);
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

      if (!target || target.punchId === "0000" || target.accountRole !== "project_manager") {
        throw new HttpError(404, "Project Manager account not found.");
      }
      if (!target.active) {
        throw new HttpError(409, "Activate this account before assigning projects.");
      }

      const assignmentFilter = projectIds.length
        ? or(eq(projects.managerId, target.id), inArray(projects.id, projectIds))
        : eq(projects.managerId, target.id);
      const affectedProjects = await tx.select({
        id: projects.id,
        name: projects.name,
        active: projects.active,
        managerId: projects.managerId,
      })
        .from(projects)
        .where(assignmentFilter)
        .orderBy(projects.id)
        .for("update");
      const projectsById = new Map(affectedProjects.map((project) => [Number(project.id), project]));

      for (const projectId of projectIds) {
        const project = projectsById.get(projectId);
        if (!project || !project.active) throw new HttpError(404, "Active project not found.");
        if (project.managerId && Number(project.managerId) !== Number(target.id)) {
          throw new HttpError(409, "This project already has an assigned manager.");
        }
      }

      for (const project of affectedProjects) {
        const shouldBeAssigned = projectIdSet.has(Number(project.id));
        if (shouldBeAssigned && Number(project.managerId) !== Number(target.id)) {
          await tx.update(projects)
            .set({ managerId: target.id })
            .where(eq(projects.id, project.id));
        } else if (!shouldBeAssigned && Number(project.managerId) === Number(target.id)) {
          await tx.update(projects)
            .set({ managerId: null })
            .where(eq(projects.id, project.id));
        }
      }

      return {
        ...target,
        projectManagerProjects: projectIds
          .map((projectId) => projectsById.get(projectId))
          .sort((left, right) => left.name.localeCompare(right.name))
          .map(({ id, name }) => ({ id, name })),
      };
    });

    return res.json({ success: true, data: toPerson(result) });
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
      if (!["employee", "admin", "project_manager"].includes(target.accountRole)) {
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

  router.patch("/:punchId/project-manager-access", requireSuperUser, validate(punchIdParamsSchema, "params"), validate(manpowerProjectManagerAccessSchema), asyncRoute(async (req, res) => {
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

    if (!target || !["employee", "project_manager"].includes(target.accountRole)) {
      throw new HttpError(404, "Employee account not found.");
    }
    if (req.validated.body.projectManagerAccess && !target.active) {
      throw new HttpError(409, "Activate this account before appointing a Project Manager.");
    }

    const [account] = await db.update(accounts)
      .set({ accountRole: req.validated.body.projectManagerAccess ? "project_manager" : "employee" })
      .where(and(
        eq(accounts.id, target.id),
        inArray(accounts.accountRole, ["employee", "project_manager"]),
        ne(accounts.punchId, "0000"),
        ...(req.validated.body.projectManagerAccess ? [eq(accounts.active, true)] : []),
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
        inArray(accounts.accountRole, ["employee", "project_manager"]),
      ))
      .returning());

    if (!account) throw new HttpError(404, "Employee account not found.");
    const [assignedProject, managerAssignments] = await Promise.all([
      db.select({ projectName: projects.name })
        .from(projects)
        .where(eq(projects.id, account.projectId))
        .limit(1),
      db.select({ id: projects.id, name: projects.name })
        .from(projects)
        .where(eq(projects.managerId, account.id))
        .orderBy(projects.name),
    ]);
    return res.json({
      success: true,
      data: toPerson({
        ...account,
        ...assignedProject,
        projectManagerProjects: managerAssignments,
      }),
    });
  }));

  router.patch("/:punchId/active", validate(punchIdParamsSchema, "params"), validate(manpowerActiveSchema), asyncRoute(async (req, res) => {
    const account = await db.transaction(async (tx) => {
      const [target] = await tx.select({
        id: accounts.id,
        punchId: accounts.punchId,
        accountRole: accounts.accountRole,
      })
        .from(accounts)
        .where(eq(accounts.punchId, req.validated.params.punchId))
        .for("update");

      if (!target || !["employee", "project_manager"].includes(target.accountRole)) return null;
      if (target.accountRole === "project_manager" && req.identity.role !== superUserRole) {
        throw new HttpError(403, "Only the Super User can change a Project Manager's account status.");
      }

      const [updated] = await tx.update(accounts)
        .set({ active: req.validated.body.active })
        .where(eq(accounts.id, target.id))
        .returning();
      return updated || null;
    });

    if (!account) throw new HttpError(404, "Employee account not found.");
    return res.json({ success: true, data: toPerson(account) });
  }));

  return router;
}
