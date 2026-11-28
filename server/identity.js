import { and, eq, gt } from "drizzle-orm";
import { accounts, authCredentials, authSessions, projects } from "../src/db/schema.js";
import { HttpError, asyncRoute } from "./errors.js";
import { createTokenHash } from "./session-cookie.js";

export const superUserRole = "super_admin";

export function hasAdminAccess(role) {
  return role === "admin" || role === superUserRole;
}

export function hasProjectManagerAccess(identity) {
  return Boolean(identity?.projectManagerProjectIds?.length);
}

export function canManageProjectReports(identity, projectId) {
  return hasAdminAccess(identity?.role)
    || (hasProjectManagerAccess(identity)
      && identity.projectManagerProjectIds.includes(String(projectId)));
}

export function canEditProjectReports(identity, projectId) {
  return identity?.role === superUserRole
    || (hasProjectManagerAccess(identity)
      && identity.projectManagerProjectIds.includes(String(projectId)));
}

export async function listProjectManagerProjectIds(db, accountId) {
  const rows = await db.select({ id: projects.id })
    .from(projects)
    .where(eq(projects.managerId, accountId))
    .orderBy(projects.id);
  return rows.map(({ id }) => String(id));
}

export function readSessionToken(req) {
  const prefix = "cscfeed_session=";
  const part = (req.headers.cookie || "").split(";")
    .map((cookie) => cookie.trim())
    .find((cookie) => cookie.startsWith(prefix));
  return part ? part.slice(prefix.length) : "";
}

export function requireProjectManager(req, _res, next) {
  if (!hasProjectManagerAccess(req.identity)) {
    return next(new HttpError(403, "Project Manager access is required."));
  }
  return next();
}

export function requireProjectReportManager(req, _res, next) {
  if (!hasAdminAccess(req.identity?.role) && !hasProjectManagerAccess(req.identity)) {
    return next(new HttpError(403, "Project Manager access is required."));
  }
  return next();
}

export async function resolveIdentity(db, token) {
  if (!token) return null;

  const [record] = await db
    .select({
      id: accounts.id,
      name: accounts.fullName,
      role: accounts.accountRole,
      punchId: accounts.punchId,
      projectId: accounts.projectId,
      username: authCredentials.username,
    })
    .from(authSessions)
    .innerJoin(accounts, eq(accounts.id, authSessions.accountId))
    .leftJoin(authCredentials, eq(authCredentials.accountId, accounts.id))
    .where(and(
      eq(authSessions.tokenHash, createTokenHash(token)),
      gt(authSessions.expiresAt, new Date()),
      eq(accounts.active, true),
    ))
    .limit(1);

  return record
    ? {
      id: Number(record.id),
      name: record.name,
      role: record.role,
      username: record.username || record.punchId,
      punchId: record.punchId,
      projectId: record.projectId ? String(record.projectId) : null,
      projectManagerProjectIds: record.role === "project_manager"
        ? await listProjectManagerProjectIds(db, record.id)
        : [],
    }
    : null;
}

export function requireIdentity(db) {
  return asyncRoute(async (req, _res, next) => {
    const identity = await resolveIdentity(db, readSessionToken(req));
    if (!identity) throw new HttpError(401, "Sign in to continue.");
    req.identity = identity;
    next();
  });
}

export function requireAdmin(req, _res, next) {
  if (!hasAdminAccess(req.identity?.role)) {
    return next(new HttpError(403, "Administrator access is required."));
  }
  return next();
}

export function requireSuperUser(req, _res, next) {
  if (req.identity?.role !== superUserRole) {
    return next(new HttpError(403, "Super User access is required."));
  }
  return next();
}
