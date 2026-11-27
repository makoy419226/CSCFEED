import {
  bigint,
  boolean,
  date,
  index,
  pgSchema,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
export * from "./auth-schema.js";

const cscfeed = pgSchema("cscfeed");

export const accounts = cscfeed.table("accounts", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  punchId: text("punch_id").notNull(),
  fullName: text("full_name").notNull(),
  designation: text("designation").notNull().default(""),
  accountRole: text("account_role").notNull().default("employee"),
  active: boolean("active").notNull().default(true),
  projectId: bigint("project_id", { mode: "number" }).references(() => projects.id, { onDelete: "set null" }),
  externalSubject: text("external_subject"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("accounts_punch_id_unique").on(table.punchId),
  uniqueIndex("accounts_external_subject_unique").on(table.externalSubject),
  index("accounts_project_id_idx").on(table.projectId),
]);

export const projects = cscfeed.table("projects", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  name: text("name").notNull(),
  description: text("description").notNull().default(""),
  color: text("color").notNull().default("blue"),
  active: boolean("active").notNull().default(true),
  managerId: bigint("manager_id", { mode: "number" }).references(() => accounts.id, { onDelete: "set null" }),
  createdBy: bigint("created_by", { mode: "number" }).references(() => accounts.id, { onDelete: "set null" }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("projects_name_ci_unique").on(sql`lower(${table.name})`),
]);

export const reports = cscfeed.table("reports", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  projectId: bigint("project_id", { mode: "number" })
    .notNull()
    .references(() => projects.id, { onDelete: "restrict" }),
  uploadedBy: bigint("uploaded_by", { mode: "number" })
    .references(() => accounts.id, { onDelete: "set null" }),
  uploaderName: text("uploader_name").notNull(),
  uploaderPunchId: text("uploader_punch_id").notNull(),
  reportDate: date("report_date", { mode: "string" }).notNull().default(sql`CURRENT_DATE`),
  title: text("title").notNull(),
  description: text("description").notNull().default(""),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull().unique(),
  contentType: text("content_type").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  archivedBy: bigint("archived_by", { mode: "number" }).references(() => accounts.id, { onDelete: "set null" }),
}, (table) => [
  index("reports_project_date_idx").on(table.projectId, table.reportDate),
  index("reports_uploader_date_idx").on(table.uploadedBy, table.reportDate),
]);

export const reportFiles = cscfeed.table("report_files", {
  id: bigint("id", { mode: "number" }).primaryKey().generatedAlwaysAsIdentity(),
  reportId: bigint("report_id", { mode: "number" })
    .notNull()
    .references(() => reports.id, { onDelete: "cascade" }),
  fileName: text("file_name").notNull(),
  storageKey: text("storage_key").notNull(),
  contentType: text("content_type").notNull(),
  fileSizeBytes: bigint("file_size_bytes", { mode: "number" }).notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("report_files_storage_key_unique").on(table.storageKey),
  index("report_files_report_id_idx").on(table.reportId),
]);
