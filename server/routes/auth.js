import bcrypt from "bcryptjs";
import express from "express";
import rateLimit from "express-rate-limit";
import { and, eq, lt } from "drizzle-orm";
import { accounts, authCredentials, authSessions } from "../../src/db/schema.js";
import { asyncRoute, HttpError } from "../errors.js";
import { readSessionToken, resolveIdentity } from "../identity.js";
import {
  clearSessionCookie,
  createSessionToken,
  createTokenHash,
  getSessionExpiry,
  setSessionCookie,
} from "../session-cookie.js";
import { validate } from "../validation.js";
import { loginSchema } from "../schemas.js";

const loginLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 10,
  standardHeaders: true,
  legacyHeaders: false,
});

export function createAuthRouter({ db, ready }) {
  const router = express.Router();

  router.use((_req, res, next) => {
    if (!ready()) {
      return res.status(503).json({
        success: false,
        message: "Authentication database is unavailable. Configure PostgreSQL and apply the database migrations.",
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

      if (!record || !record.active || record.role !== "admin"
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
      })
        .from(accounts)
        .where(and(
          eq(accounts.punchId, credentials.employeeId),
          eq(accounts.active, true),
        ))
        .limit(1);

      if (!record || record.role !== "employee") {
        throw new HttpError(401, "No active employee account matches that Punch ID.");
      }
      account = record;
    }

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

  return router;
}
