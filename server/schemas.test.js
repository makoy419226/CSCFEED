import assert from "node:assert/strict";
import test from "node:test";
import {
  adminProfileUpdateSchema,
  manpowerAdminAccessSchema,
  manpowerSchema,
  projectManagerAssignmentSchema,
  reportBulkDeleteSchema,
  reportEditSchema,
  reportFormSchema,
  reportQuerySchema,
} from "./schemas.js";

test("report forms require a valid calendar date and positive project id", () => {
  assert.equal(reportFormSchema.safeParse({
    projectId: "2",
    reportDate: "2026-02-28",
    title: "Progress",
    description: "",
  }).success, true);

  assert.equal(reportFormSchema.safeParse({
    projectId: "0",
    reportDate: "2026-02-30",
    title: "",
  }).success, false);
});

test("report query rejects a reversed date range", () => {
  assert.equal(reportQuerySchema.safeParse({
    fromDate: "2026-06-02",
    toDate: "2026-06-01",
  }).success, false);
});

test("Project Manager assignments accept one positive project id or an explicit unassignment", () => {
  assert.equal(projectManagerAssignmentSchema.safeParse({ projectId: "4" }).success, true);
  assert.equal(projectManagerAssignmentSchema.safeParse({ projectId: null }).success, true);
  assert.equal(projectManagerAssignmentSchema.safeParse({ projectId: 0 }).success, false);
});

test("report edits validate details and attachment removal inputs", () => {
  const reportEdit = {
    title: "Weekly progress",
    description: "Site update",
    reportDate: "2026-06-02",
    removeFileIds: ["11"],
    removeLegacyFile: false,
  };
  assert.equal(reportEditSchema.safeParse(reportEdit).success, true);
  assert.equal(reportEditSchema.safeParse({ ...reportEdit, removeFileIds: [11, 11] }).success, false);
  assert.equal(reportEditSchema.safeParse({ ...reportEdit, reportDate: "2026-02-30" }).success, false);
});

test("report deletion requires unique positive ids and limits bulk requests", () => {
  assert.equal(reportBulkDeleteSchema.safeParse({ ids: ["17", 18] }).success, true);
  assert.equal(reportBulkDeleteSchema.safeParse({ ids: [17, 17] }).success, false);
  assert.equal(reportBulkDeleteSchema.safeParse({ ids: [] }).success, false);
  assert.equal(reportBulkDeleteSchema.safeParse({ ids: Array.from({ length: 101 }, (_, index) => index + 1) }).success, false);
});

test("admin profile updates require the current password and validate optional new passwords", () => {
  const base = { displayName: "Site Administrator", currentPassword: "current-password" };

  assert.equal(adminProfileUpdateSchema.safeParse(base).success, true);
  assert.equal(adminProfileUpdateSchema.safeParse({ ...base, newPassword: "" }).success, true);
  assert.equal(adminProfileUpdateSchema.safeParse({ ...base, newPassword: "short" }).success, false);
  assert.equal(adminProfileUpdateSchema.safeParse({ ...base, newPassword: "a".repeat(73) }).success, false);
  assert.equal(adminProfileUpdateSchema.safeParse({ displayName: "Admin" }).success, false);
});

test("manpower accounts cannot claim the reserved Super User Punch ID", () => {
  const account = { punchId: "1234", name: "Site Employee", designation: "Engineer" };

  assert.equal(manpowerSchema.safeParse(account).success, true);
  assert.equal(manpowerSchema.safeParse({ ...account, punchId: "0000" }).success, false);
  assert.equal(manpowerAdminAccessSchema.safeParse({ adminAccess: true }).success, true);
  assert.equal(manpowerAdminAccessSchema.safeParse({ adminAccess: "true" }).success, false);
});
