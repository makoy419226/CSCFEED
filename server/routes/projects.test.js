import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { handleError } from "../errors.js";
import { accounts, projects } from "../../src/db/schema.js";
import { createProjectsRouter } from "./projects.js";

function createDb({ deleted = [], deleteError } = {}) {
  return {
    select() {
      const query = {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() {
          return [{ id: 1, name: "Administrator", role: "admin", punchId: "0000", username: "admin" }];
        },
      };
      return query;
    },
    delete() {
      return {
        where() { return this; },
        async returning() {
          if (deleteError) throw deleteError;
          return deleted;
        },
      };
    },
  };
}

async function requestDelete(db, id = "17") {
  const app = express();
  app.use("/api/projects", createProjectsRouter({ db, ready: () => true }));
  app.use(handleError);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}/api/projects/${id}`, {
      method: "DELETE",
      headers: { cookie: "cscfeed_session=test-session" },
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("project deletion returns the deleted project id", async () => {
  const response = await requestDelete(createDb({ deleted: [{ id: 17 }] }));

  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { success: true, data: { id: "17" } });
});

test("project deletion reports a conflict when reports reference it", async () => {
  const response = await requestDelete(createDb({ deleteError: { code: "23503" } }));

  assert.equal(response.status, 409);
  assert.deepEqual(await response.json(), {
    success: false,
    message: "Cannot delete a project that has reports.",
  });
});

test("project deletion returns not found for an unknown project", async () => {
  const response = await requestDelete(createDb());

  assert.equal(response.status, 404);
  assert.deepEqual(await response.json(), { success: false, message: "Project not found." });
});

function createManagerDb({ project, manager, previous = null }) {
  const updates = [];
  const identity = { id: 1, name: "Administrator", role: "admin", punchId: "0000", username: "admin" };
  let projectSelects = 0;
  const tx = {
    select() {
      let table;
      return {
        from(value) { table = value; return this; },
        where() { return this; },
        async for() {
          if (table === accounts) return manager ? [manager] : [];
          projectSelects += 1;
          if (projectSelects === 1) return project ? [project] : [];
          return previous ? [previous] : [];
        },
      };
    },
    update(table) {
      return { set(values) { return { async where() { updates.push({ table, values }); } }; } };
    },
  };
  return {
    updates,
    select() {
      return {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() { return [identity]; },
      };
    },
    async transaction(callback) { return callback(tx); },
  };
}

async function patchManager(db, body, id = "5") {
  const app = express();
  app.use(express.json());
  app.use("/api/projects", createProjectsRouter({ db, ready: () => true }));
  app.use(handleError);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}/api/projects/${id}/manager`, {
      method: "PATCH",
      headers: { cookie: "cscfeed_session=test-session", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

const managedProject = { id: 5, name: "Project A", description: "", color: "blue", managerId: null };
const activeEmployee = { id: 7, punchId: "2468", fullName: "Jane Employee", accountRole: "employee", active: true };

test("an administrator appoints an employee as manager of a selected project", async () => {
  const db = createManagerDb({ project: managedProject, manager: activeEmployee });
  const response = await patchManager(db, { punchId: "2468" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.id, "5");
  assert.equal(body.data.managerPunchId, "2468");
  assert.equal(body.data.managerName, "Jane Employee");
  assert.equal(body.data.previousProjectId, null);
  assert.deepEqual(db.updates, [{ table: projects, values: { managerId: 7 } }]);
});

test("appointing replaces the current manager and moves the employee off their previous project", async () => {
  const db = createManagerDb({
    project: { ...managedProject, managerId: 11 },
    manager: activeEmployee,
    previous: { id: 9 },
  });
  const response = await patchManager(db, { punchId: "2468" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.data.previousProjectId, "9");
  assert.deepEqual(db.updates, [
    { table: projects, values: { managerId: null } },
    { table: projects, values: { managerId: 7 } },
  ]);
});

test("clearing the manager removes the assignment", async () => {
  const db = createManagerDb({ project: { ...managedProject, managerId: 7 } });
  const response = await patchManager(db, { punchId: null });

  assert.equal(response.status, 200);
  assert.equal((await response.json()).data.managerPunchId, null);
  assert.deepEqual(db.updates, [{ table: projects, values: { managerId: null } }]);
});

test("inactive or admin accounts cannot be appointed", async () => {
  for (const manager of [{ ...activeEmployee, active: false }, { ...activeEmployee, accountRole: "admin" }]) {
    const db = createManagerDb({ project: managedProject, manager });
    const response = await patchManager(db, { punchId: "2468" });

    assert.equal(response.status, 409);
    assert.equal((await response.json()).message, "Only active employee accounts can be project managers.");
    assert.equal(db.updates.length, 0);
  }
});
