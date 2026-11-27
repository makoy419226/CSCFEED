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

test("a Project Manager can archive reports only in their assigned project", () => {
  const identity = { role: "project_manager", projectManagerProjectIds: ["12", "13"] };
  assert.doesNotThrow(() => assertReportTransition("active", "archived", identity, 12));
  assert.doesNotThrow(() => assertReportTransition("active", "archived", identity, 13));
  assert.throws(
    () => assertReportTransition("active", "archived", identity, 14),
    (error) => error.status === 403,
  );
});

test("archived reports cannot transition back to active", () => {
  assert.throws(
    () => assertReportTransition("archived", "active", { role: "admin" }),
    (error) => error.status === 409,
  );
});
