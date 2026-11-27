import bcrypt from "bcryptjs";
import { eq, sql } from "drizzle-orm";
import { accounts, authCredentials, projects } from "../src/db/schema.js";

const reservedAdminPunchId = "0000";
const starterProjects = [
  { name: "Harbor Point Residences", description: "", color: "blue" },
  { name: "Northline Logistics Hub", description: "", color: "orange" },
  { name: "Cedar Grove School", description: "", color: "green" },
  { name: "Metro West Utilities", description: "", color: "purple" },
];

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
  if (credential && credential.role !== "admin") {
    throw new Error("The reserved admin username is assigned to a non-administrator account.");
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
        if (credentialAfterLock.role !== "admin") {
          throw new Error("The reserved admin username is assigned to a non-administrator account.");
        }
        return credentialAfterLock.accountId;
      }

      const [existingAccount] = await tx.select().from(accounts)
        .where(eq(accounts.punchId, reservedAdminPunchId))
        .for("update");
      let account = existingAccount;
      if (account && account.accountRole !== "admin") {
        throw new Error(`Punch ID ${reservedAdminPunchId} is reserved for the administrator account.`);
      }
      if (!account) {
        [account] = await tx.insert(accounts).values({
          punchId: reservedAdminPunchId,
          fullName: "CSC Feed Administrator",
          designation: "System Administrator",
          accountRole: "admin",
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

  const [existingProject] = await db.select({ id: projects.id }).from(projects).limit(1);
  if (!existingProject) {
    await db.transaction(async (tx) => {
      for (const project of starterProjects) {
        await tx.insert(projects).values({ ...project, createdBy: accountId }).onConflictDoNothing();
      }
    });
  }
}
