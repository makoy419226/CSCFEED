import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { accounts, authCredentials } from "../src/db/schema.js";
import { superUserRole } from "./identity.js";

const reservedAdminPunchId = "0000";

export async function bootstrapApplication({ db }) {
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD || (
    process.env.NODE_ENV === "production" ? "" : "admin123"
  );
  if (process.env.NODE_ENV === "production" && password.length < 12) {
    throw new Error("Set BOOTSTRAP_ADMIN_PASSWORD to at least 12 characters in production.");
  }
  if (Buffer.byteLength(password, "utf8") > 72) {
    throw new Error("BOOTSTRAP_ADMIN_PASSWORD cannot exceed 72 UTF-8 bytes.");
  }

  const [credential] = await db.select({
    accountId: authCredentials.accountId,
    role: accounts.accountRole,
  })
    .from(authCredentials)
    .innerJoin(accounts, eq(accounts.id, authCredentials.accountId))
    .where(eq(authCredentials.username, "admin"))
    .limit(1);

  let accountId = credential?.accountId;
  if (credential && !["admin", superUserRole].includes(credential.role)) {
    throw new Error("The reserved admin username is assigned to a non-administrator account.");
  }
  if (credential && credential.role !== superUserRole) {
    await db.update(accounts)
      .set({ accountRole: superUserRole })
      .where(eq(accounts.id, credential.accountId));
  }
  if (!credential) {
    const passwordHash = await bcrypt.hash(password, 12);
    accountId = await db.transaction(async (tx) => {
      await tx.execute(sql`SELECT pg_advisory_xact_lock(8451207)`);
      const [credentialAfterLock] = await tx.select({
        accountId: authCredentials.accountId,
        role: accounts.accountRole,
      })
        .from(authCredentials)
        .innerJoin(accounts, eq(accounts.id, authCredentials.accountId))
        .where(eq(authCredentials.username, "admin"))
        .limit(1);
      if (credentialAfterLock) {
        if (!["admin", superUserRole].includes(credentialAfterLock.role)) {
          throw new Error("The reserved admin username is assigned to a non-administrator account.");
        }
        if (credentialAfterLock.role !== superUserRole) {
          await tx.update(accounts)
            .set({ accountRole: superUserRole })
            .where(eq(accounts.id, credentialAfterLock.accountId));
        }
        return credentialAfterLock.accountId;
      }

      const [existingAccount] = await tx.select().from(accounts)
        .where(eq(accounts.punchId, reservedAdminPunchId))
        .for("update");
      let account = existingAccount;
      if (account && !["admin", superUserRole].includes(account.accountRole)) {
        throw new Error(`Punch ID ${reservedAdminPunchId} is reserved for the administrator account.`);
      }
      if (account && account.accountRole !== superUserRole) {
        [account] = await tx.update(accounts)
          .set({ accountRole: superUserRole })
          .where(eq(accounts.id, account.id))
          .returning();
      }
      if (!account) {
        [account] = await tx.insert(accounts).values({
          punchId: reservedAdminPunchId,
          fullName: "CSC Feed Administrator",
          designation: "System Administrator",
          accountRole: superUserRole,
        }).returning();
      }

      const [assigned] = await tx.select({ accountId: authCredentials.accountId })
        .from(authCredentials)
        .where(eq(authCredentials.username, "admin"))
        .limit(1);
      if (assigned && Number(assigned.accountId) !== Number(account.id)) {
        throw new Error("The reserved admin username is already assigned to another account.");
      }
      if (!assigned) {
        await tx.insert(authCredentials).values({
          accountId: account.id,
          username: "admin",
          passwordHash,
        });
      }
      return Number(account.id);
    });
    console.info("Created initial administrator account.");
  } else if (process.env.NODE_ENV === "production") {
    await db.update(authCredentials)
      .set({ passwordHash: await bcrypt.hash(password, 12) })
      .where(eq(authCredentials.username, "admin"));
  }
}
