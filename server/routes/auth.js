import bcrypt from "bcryptjs";
import express from "express";
import rateLimit from "express-rate-limit";
import { and, eq, lt, ne } from "drizzle-orm";
import { accounts, authCredentials, authSessions } from "../../src/db/schema.js";
import { asyncRoute, HttpError } from "../errors.js";
import { listProjectManagerProjectIds, readSessionToken, requireIdentity, requireSuperUser, resolveIdentity, superUserRole } from "../identity.js";
import {
  clearSessionCookie,
  createSessionToken,
  createTokenHash,
  getSessionExpiry,
  setSessionCookie,
} from "../session-cookie.js";
import { validate } from "../validation.js";
import { adminProfileUpdateSchema, loginSchema, ownPasswordUpdateSchema } from "../schemas.js";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

const profileUpdateLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 5,
  standardHeaders: true,
  legacyHeaders: false,
});

export function createAuthRouter({ db, ready, startupError = () => null }) {
  const router = express.Router();

  router.use((_req, res, next) => {
    if (!ready()) {
      const reason = startupError();
      return res.status(503).json({
        success: false,
        message: reason
          ? `The API could not start: ${reason}. Fix it, then restart with npm run dev.`
          : "Authentication database is unavailable. Configure PostgreSQL and apply the database migrations.",
      });
    }
    return next();
  });

  router.get("/session", asyncRoute(async (req, res) => {
    const identity = await resolveIdentity(db, readSessionToken(req));
    if (!identity) throw new HttpError(401, "Sign in to continue.");
    return res.json({ success: true, user: identity });
  }));

  router.post("/login", loginLimiter, validate(loginSchema), asyncRoute(async (req, res) => {
    const credentials = req.validated.body;
    let account;

    if ("username" in credentials) {
      const [record] = await db.select({
        id: accounts.id,
        fullName: accounts.fullName,
        role: accounts.accountRole,
        punchId: accounts.punchId,
        active: accounts.active,
        username: authCredentials.username,
        passwordHash: authCredentials.passwordHash,
      })
        .from(authCredentials)
        .innerJoin(accounts, eq(accounts.id, authCredentials.accountId))
        .where(eq(authCredentials.username, credentials.username.toLowerCase()))
        .limit(1);

      if (!record || !record.active || record.role !== superUserRole
        || !(await bcrypt.compare(credentials.password, record.passwordHash))) {
        throw new HttpError(401, "Invalid administrator username or password.");
      }
      account = record;
    } else {
      const [record] = await db.select({
        id: accounts.id,
        fullName: accounts.fullName,
        role: accounts.accountRole,
        punchId: accounts.punchId,
        passwordHash: authCredentials.passwordHash,
      })
        .from(accounts)
        .leftJoin(authCredentials, eq(authCredentials.accountId, accounts.id))
        .where(and(
          eq(accounts.punchId, credentials.employeeId),
          eq(accounts.active, true),
        ))
        .limit(1);

      if (!record || !["employee", "admin", "project_manager"].includes(record.role)) {
        throw new HttpError(401, "No active employee account matches that Punch ID.");
      }
      const passwordApplies = ["employee", "project_manager"].includes(record.role);
      if (passwordApplies && record.passwordHash) {
        if (!credentials.password || !(await bcrypt.compare(credentials.password, record.passwordHash))) {
          throw new HttpError(401, "Invalid Punch ID or password.");
        }
      } else if (credentials.password) {
        throw new HttpError(401, "Invalid Punch ID or password.");
      }
      account = record;
    }
    const projectManagerProjectIds = account.role === "project_manager"
      ? await listProjectManagerProjectIds(db, account.id)
      : [];

    const token = createSessionToken();
    const expiresAt = getSessionExpiry();
    await db.delete(authSessions).where(lt(authSessions.expiresAt, new Date()));
    await db.insert(authSessions).values({
      tokenHash: createTokenHash(token),
      accountId: account.id,
      expiresAt,
    });
    setSessionCookie(res, token);

    return res.json({
      success: true,
      user: {
        name: account.fullName,
        role: account.role,
        username: account.username || account.punchId,
        punchId: account.punchId,
        projectManagerProjectIds,
      },
    });
  }));

  router.post("/logout", asyncRoute(async (req, res) => {
    const token = readSessionToken(req);
    if (token) {
      await db.delete(authSessions).where(eq(authSessions.tokenHash, createTokenHash(token)));
    }
    clearSessionCookie(res);
    return res.json({ success: true });
  }));

  router.patch("/password", profileUpdateLimiter, requireIdentity(db), validate(ownPasswordUpdateSchema), asyncRoute(async (req, res) => {
    const { currentPassword, newPassword } = req.validated.body;
    const currentTokenHash = createTokenHash(readSessionToken(req));

    await db.transaction(async (tx) => {
      const [account] = await tx.select({
        id: accounts.id,
        punchId: accounts.punchId,
        accountRole: accounts.accountRole,
        active: accounts.active,
      })
        .from(accounts)
        .where(eq(accounts.id, req.identity.id))
        .for("update");

      if (!account || !account.active || !["employee", "project_manager"].includes(account.accountRole)) {
        throw new HttpError(403, "Password management is available to active employees and Project Managers.");
      }

      const [credential] = await tx.select({ passwordHash: authCredentials.passwordHash })
        .from(authCredentials)
        .where(eq(authCredentials.accountId, account.id))
        .limit(1);
      if (credential && (!currentPassword || !(await bcrypt.compare(currentPassword, credential.passwordHash)))) {
        throw new HttpError(401, "Current password is incorrect.");
      }

      const passwordHash = await bcrypt.hash(newPassword, 12);
      await tx.insert(authCredentials)
        .values({ accountId: account.id, username: account.punchId, passwordHash })
        .onConflictDoUpdate({
          target: authCredentials.accountId,
          set: { username: account.punchId, passwordHash },
        });
      await tx.delete(authSessions).where(and(
        eq(authSessions.accountId, account.id),
        ne(authSessions.tokenHash, currentTokenHash),
      ));
    });

    return res.json({ success: true, data: { passwordSet: true } });
  }));

  router.patch("/profile", profileUpdateLimiter, requireIdentity(db), requireSuperUser, validate(adminProfileUpdateSchema), asyncRoute(async (req, res) => {
    const { displayName, currentPassword, newPassword } = req.validated.body;
    const [credential] = await db.select({ passwordHash: authCredentials.passwordHash })
      .from(authCredentials)
      .where(eq(authCredentials.accountId, req.identity.id))
      .limit(1);

    if (!credential || !(await bcrypt.compare(currentPassword, credential.passwordHash))) {
      throw new HttpError(401, "Current password is incorrect.");
    }

    const passwordHash = newPassword ? await bcrypt.hash(newPassword, 12) : null;
    const currentTokenHash = createTokenHash(readSessionToken(req));
    await db.transaction(async (tx) => {
      await tx.update(accounts)
        .set({ fullName: displayName })
        .where(eq(accounts.id, req.identity.id));

      if (passwordHash) {
        await tx.update(authCredentials)
          .set({ passwordHash })
          .where(eq(authCredentials.accountId, req.identity.id));
        await tx.delete(authSessions).where(and(
          eq(authSessions.accountId, req.identity.id),
          ne(authSessions.tokenHash, currentTokenHash),
        ));
      }
    });

    return res.json({
      success: true,
      user: { ...req.identity, name: displayName },
    });
  }));

  return router;
}
