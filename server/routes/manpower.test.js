import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { accounts, projects } from "../../src/db/schema.js";
import { handleError } from "../errors.js";
import { createManpowerRouter } from "./manpower.js";

function createDb(role, target = null) {
  let selectCalls = 0;
  const updates = [];
  const db = {
    updates,
    select() {
      const call = ++selectCalls;
      return {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() {
          if (call % 2 === 1) {
            return [{
              id: role === "super_admin" ? 1 : 2,
              name: role === "super_admin" ? "Super User" : "Appointed Admin",
              role,
              punchId: role === "super_admin" ? "0000" : "1234",
              username: role,
            }];
          }
          return target ? [target] : [];
        },
        async orderBy() { return target ? [target] : []; },
      };
    },
    update(table) {
      return {
        set(values) {
          return {
            where() {
              return {
                async returning() {
                  updates.push({ table, values });
                  if (!target) return [];
                  target = { ...target, ...values };
                  return [target];
                },
              };
            },
          };
        },
      };
    },
  };
  return db;
}

function createAssignmentDb(target, destination, currentAssignment = null, role = "super_admin") {
  const updates = [];
  let projectSelectCount = 0;
  const identity = {
    id: 2,
    name: role === "super_admin" ? "Super User" : "Appointed Admin",
    role,
    punchId: "1234",
    username: "admin",
    projectManagerProjectId: null,
  };
  const tx = {
    select() {
      let table;
      return {
        from(value) { table = value; return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() { return [identity]; },
        async for() {
          if (table === accounts) return [target];
          projectSelectCount += 1;
          return projectSelectCount === 1
            ? currentAssignment ? [currentAssignment] : []
            : destination ? [destination] : [];
        },
      };
    },
    update(table) {
      return {
        set(values) {
          return {
            async where() {
              updates.push({ table, values });
              return [];
            },
          };
        },
      };
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

function createProjectTransferDb({ target, destination = null, currentManager = null, role = "super_admin" }) {
  const updates = [];
  const identity = {
    id: 2,
    name: role === "super_admin" ? "Super User" : "Appointed Admin",
    role,
    punchId: role === "super_admin" ? "0000" : "1234",
    username: role,
  };
  const tx = {
    select() {
      let table;
      return {
        from(value) { table = value; return this; },
        where() { return this; },
        async for() {
          if (table === accounts) return target ? [target] : [];
          return destination ? [destination] : [];
        },
        async limit() { return currentManager ? [currentManager] : []; },
      };
    },
    update(table) {
      return {
        set(values) {
          return {
            async where() {
              updates.push({ table, values });
            },
          };
        },
      };
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

async function withManpowerApp(db, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/manpower", createManpowerRouter({ db }));
  app.use(handleError);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    await run((url, body) => fetch(`http://127.0.0.1:${port}/api/manpower${url}`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: "cscfeed_session=test-session",
      },
      body: JSON.stringify(body),
    }));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const employeeAccount = {
  id: 9,
  punchId: "2468",
  fullName: "Site Employee",
  designation: "Engineer",
  accountRole: "employee",
  active: true,
};

test("only the Super User can grant admin access", async () => {
  const db = createDb("admin", employeeAccount);

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/admin-access", { adminAccess: true });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Super User access is required.");
  });

  assert.equal(db.updates.length, 0);
});

test("the Super User can grant and remove admin access", async () => {
  const db = createDb("super_admin", { ...employeeAccount });

  await withManpowerApp(db, async (patch) => {
    const grantResponse = await patch("/2468/admin-access", { adminAccess: true });
    const granted = await grantResponse.json();
    assert.equal(grantResponse.status, 200);
    assert.equal(granted.data.adminAccess, true);

    const revokeResponse = await patch("/2468/admin-access", { adminAccess: false });
    const revoked = await revokeResponse.json();
    assert.equal(revokeResponse.status, 200);
    assert.equal(revoked.data.adminAccess, false);
  });

  assert.equal(db.updates.length, 2);
  assert.deepEqual(db.updates.map(({ table, values }) => ({ table, values })), [
    { table: accounts, values: { accountRole: "admin" } },
    { table: accounts, values: { accountRole: "employee" } },
  ]);
});

test("the Super User account cannot be changed through the admin access route", async () => {
  const db = createDb("super_admin", null);

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/0000/admin-access", { adminAccess: false });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "The Super User account cannot be changed.");
  });

  assert.equal(db.updates.length, 0);
});

test("inactive accounts cannot be promoted", async () => {
  const db = createDb("super_admin", { ...employeeAccount, active: false });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/admin-access", { adminAccess: true });

    assert.equal(response.status, 409);
    assert.equal((await response.json()).message, "Activate this account before granting admin access.");
  });

  assert.equal(db.updates.length, 0);
});

test("an administrator can assign an active employee to an available project", async () => {
  const target = { ...employeeAccount };
  const destination = { id: 5, name: "Project A", managerId: null };
  const db = createAssignmentDb(target, destination);

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project-manager", { projectId: 5 });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.projectManagerProjectId, "5");
    assert.equal(body.data.projectManagerProjectName, "Project A");
  });

  assert.deepEqual(db.updates, [{ table: projects, values: { managerId: target.id } }]);
});

test("a project with another assigned manager cannot be reassigned", async () => {
  const db = createAssignmentDb(
    { ...employeeAccount },
    { id: 5, name: "Project A", managerId: 11 },
  );

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project-manager", { projectId: 5 });

    assert.equal(response.status, 409);
    assert.equal((await response.json()).message, "This project already has an assigned manager.");
  });

  assert.equal(db.updates.length, 0);
});

test("appointed admins cannot use the per-employee Project Manager route", async () => {
  const db = createAssignmentDb({ ...employeeAccount }, { id: 5, name: "Project A", managerId: null }, null, "admin");

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project-manager", { projectId: 5 });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Super User access is required.");
  });

  assert.equal(db.updates.length, 0);
});

test("the Super User can transfer an employee to an active project", async () => {
  const db = createProjectTransferDb({
    target: { ...employeeAccount, projectId: 2 },
    destination: { id: 5, name: "Project B" },
  });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project", { projectId: 5 });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.projectId, "5");
    assert.equal(body.data.projectName, "Project B");
    assert.equal(body.data.projectManagerProjectId, null);
  });

  assert.deepEqual(db.updates, [{ table: accounts, values: { projectId: 5 } }]);
});

test("the Super User can remove an employee's project assignment", async () => {
  const db = createProjectTransferDb({
    target: { ...employeeAccount, projectId: 5 },
  });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project", { projectId: null });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.projectId, null);
    assert.equal(body.data.projectName, null);
  });

  assert.deepEqual(db.updates, [{ table: accounts, values: { projectId: null } }]);
});

test("appointed admins cannot transfer employees between projects", async () => {
  const db = createProjectTransferDb({
    target: { ...employeeAccount, projectId: null },
    destination: { id: 5, name: "Project B" },
    role: "admin",
  });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project", { projectId: 5 });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Super User access is required.");
  });

  assert.equal(db.updates.length, 0);
});

test("the Super User account cannot be transferred", async () => {
  const db = createProjectTransferDb({
    target: { ...employeeAccount, punchId: "0000", accountRole: "super_admin" },
    destination: { id: 5, name: "Project B" },
  });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/0000/project", { projectId: 5 });

    assert.equal(response.status, 404);
    assert.equal((await response.json()).message, "Employee account not found.");
  });

  assert.equal(db.updates.length, 0);
});
