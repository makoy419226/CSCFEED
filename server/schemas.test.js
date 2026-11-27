import assert from "node:assert/strict";
import test from "node:test";
import { adminProfileUpdateSchema, reportFormSchema, reportQuerySchema } from "./schemas.js";

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

test("admin profile updates require the current password and validate optional new passwords", () => {
  const base = { displayName: "Site Administrator", currentPassword: "current-password" };

  assert.equal(adminProfileUpdateSchema.safeParse(base).success, true);
  assert.equal(adminProfileUpdateSchema.safeParse({ ...base, newPassword: "" }).success, true);
  assert.equal(adminProfileUpdateSchema.safeParse({ ...base, newPassword: "short" }).success, false);
  assert.equal(adminProfileUpdateSchema.safeParse({ ...base, newPassword: "a".repeat(73) }).success, false);
  assert.equal(adminProfileUpdateSchema.safeParse({ displayName: "Admin" }).success, false);
});
