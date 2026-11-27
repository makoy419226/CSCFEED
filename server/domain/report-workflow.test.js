import assert from "node:assert/strict";
import test from "node:test";
import { assertReportTransition } from "./report-workflow.js";

test("an administrator can archive an active report", () => {
  assert.doesNotThrow(() => assertReportTransition("active", "archived", { role: "admin" }));
});

test("employees cannot archive reports", () => {
  assert.throws(
    () => assertReportTransition("active", "archived", { role: "employee" }),
    (error) => error.status === 403,
  );
});

test("archived reports cannot transition back to active", () => {
  assert.throws(
    () => assertReportTransition("archived", "active", { role: "admin" }),
    (error) => error.status === 409,
  );
});
