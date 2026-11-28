import {
  bigint,
  index,
  pgSchema,
  text,
  timestamp,
} from "drizzle-orm/pg-core";

const cscfeed = pgSchema("cscfeed");

export const authCredentials = cscfeed.table("auth_credentials", {
  accountId: bigint("account_id", { mode: "number" }).primaryKey(),
  username: text("username").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  passwordCiphertext: text("password_ciphertext"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export const authSessions = cscfeed.table("auth_sessions", {
  tokenHash: text("token_hash").primaryKey(),
  accountId: bigint("account_id", { mode: "number" }).notNull(),
  expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  index("auth_sessions_account_id_idx").on(table.accountId),
  index("auth_sessions_expires_at_idx").on(table.expiresAt),
]);
