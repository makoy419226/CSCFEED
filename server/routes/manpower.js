import express from "express";
import { and, eq, ne } from "drizzle-orm";
import { accounts } from "../../src/db/schema.js";
import { asyncRoute, HttpError } from "../errors.js";
import { requireAdmin, requireIdentity } from "../identity.js";
import {
  manpowerActiveSchema,
  manpowerSchema,
  punchIdParamsSchema,
} from "../schemas.js";
import { validate } from "../validation.js";

function toPerson(account) {
  return {
    punchId: account.punchId,
    name: account.fullName,
    designation: account.designation,
    active: account.active,
  };
}

export function createManpowerRouter({ db }) {
  const router = express.Router();
  router.use(requireIdentity(db), requireAdmin);

  router.get("/", asyncRoute(async (_req, res) => {
    const people = await db.select().from(accounts)
      .where(and(eq(accounts.accountRole, "employee"), ne(accounts.punchId, "0000")))
      .orderBy(accounts.fullName);
    return res.json({ success: true, data: people.map(toPerson) });
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
    return res.json({ success: true, data: toPerson(account) });
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
