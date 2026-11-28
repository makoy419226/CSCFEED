import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { accounts, projects } from "../../src/db/schema.js";
import { handleError } from "../errors.js";
import { encryptPassword } from "../password-vault.js";
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
    projectManagerProjectIds: [],
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
          return destination ? [destination] : [];
        },
        async orderBy() {
          return [
            ...(currentAssignment ? [currentAssignment] : []),
            ...(updates.some(({ values }) => values.managerId === target.id) && destination ? [destination] : []),
          ];
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

function createProjectManagerAssignmentsDb({ target, projects: projectRows, role = "super_admin" }) {
  const updates = [];
  const identity = {
    id: 2,
    name: role === "super_admin" ? "Super User" : "Appointed Admin",
    role,
    punchId: role === "super_admin" ? "0000" : "1234",
    username: role,
    projectManagerProjectIds: [],
  };
  const tx = {
    select() {
      let table;
      return {
        from(value) { table = value; return this; },
        where() { return this; },
        orderBy() { return this; },
        async for() {
          if (table === accounts) return target ? [target] : [];
          return projectRows;
        },
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

function createManpowerActiveDb({ target, role }) {
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
      return {
        from() { return this; },
        where() { return this; },
        async for() { return target ? [target] : []; },
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
                  Object.assign(target, values);
                  return [target];
                },
              };
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

function createPasswordDb(role, passwordCiphertext = null) {
  let selectCalls = 0;
  const writes = [];
  const identity = {
    id: role === "super_admin" ? 1 : 2,
    name: role === "super_admin" ? "Super User" : "Appointed Admin",
    role,
    punchId: role === "super_admin" ? "0000" : "1234",
    username: role,
  };
  const db = {
    writes,
    select() {
      const call = ++selectCalls;
      return {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() {
          return call === 1 ? [identity] : [{ passwordCiphertext }];
        },
      };
    },
    async transaction(callback) {
      const tx = {
        select() {
          return {
            from() { return this; },
            where() { return this; },
            async for() {
              return [{ id: 9, punchId: "2468", accountRole: "employee" }];
            },
          };
        },
        insert(table) {
          return {
            values(values) {
              writes.push({ table, values });
              return {
                onConflictDoUpdate({ set }) {
                  writes.push({ table, set });
                },
              };
            },
          };
        },
        delete(table) {
          return {
            where() {
              writes.push({ table, deleted: true });
            },
          };
        },
      };
      return callback(tx);
    },
  };
  return db;
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
    await run((url, body, method = "PATCH") => {
      const options = {
        method,
        headers: {
          "Content-Type": "application/json",
          cookie: "cscfeed_session=test-session",
        },
      };
      if (method !== "GET" && method !== "HEAD") options.body = JSON.stringify(body);
      return fetch(`http://127.0.0.1:${port}/api/manpower${url}`, options);
    });
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
const activeProjectManager = { ...employeeAccount, accountRole: "project_manager" };

test("appointed admins can view set manpower passwords", async () => {
  const originalKey = process.env.PASSWORD_ENCRYPTION_KEY;
  process.env.PASSWORD_ENCRYPTION_KEY = "a".repeat(64);
  try {
    const passwordCiphertext = encryptPassword("employee-password");
    for (const role of ["admin", "super_admin"]) {
      const db = createPasswordDb(role, passwordCiphertext);

      await withManpowerApp(db, async (request) => {
        const response = await request("/2468/password", undefined, "GET");

        assert.equal(response.status, 200);
        assert.equal((await response.json()).data.password, "employee-password");
      });
    }
  } finally {
    if (originalKey === undefined) delete process.env.PASSWORD_ENCRYPTION_KEY;
    else process.env.PASSWORD_ENCRYPTION_KEY = originalKey;
  }
});

test("non-admins cannot view set manpower passwords", async () => {
  const db = createPasswordDb("employee");

  await withManpowerApp(db, async (request) => {
    const response = await request("/2468/password", undefined, "GET");

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Administrator access is required.");
  });
});

test("only the Super User can change manpower passwords", async () => {
  const originalKey = process.env.PASSWORD_ENCRYPTION_KEY;
  process.env.PASSWORD_ENCRYPTION_KEY = "b".repeat(64);
  try {
    const adminDb = createPasswordDb("admin");
    await withManpowerApp(adminDb, async (request) => {
      const response = await request("/2468/password", { newPassword: "a-secure-password" });

      assert.equal(response.status, 403);
      assert.equal((await response.json()).message, "Super User access is required.");
    });
    assert.equal(adminDb.writes.length, 0);

    const superUserDb = createPasswordDb("super_admin");
    await withManpowerApp(superUserDb, async (request) => {
      const response = await request("/2468/password", { newPassword: "a-secure-password" });

      assert.equal(response.status, 200);
      assert.equal((await response.json()).data.passwordSet, true);
    });
    assert.equal(superUserDb.writes.length, 3);
  } finally {
    if (originalKey === undefined) delete process.env.PASSWORD_ENCRYPTION_KEY;
    else process.env.PASSWORD_ENCRYPTION_KEY = originalKey;
  }
});

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

test("the Super User can appoint and remove a Project Manager", async () => {
  const db = createDb("super_admin", { ...employeeAccount });

  await withManpowerApp(db, async (patch) => {
    const appointResponse = await patch("/2468/project-manager-access", { projectManagerAccess: true });
    const appointed = await appointResponse.json();
    assert.equal(appointResponse.status, 200);
    assert.equal(appointed.data.isProjectManager, true);

    const revokeResponse = await patch("/2468/project-manager-access", { projectManagerAccess: false });
    const revoked = await revokeResponse.json();
    assert.equal(revokeResponse.status, 200);
    assert.equal(revoked.data.isProjectManager, false);
  });

  assert.deepEqual(db.updates.map(({ table, values }) => ({ table, values })), [
    { table: accounts, values: { accountRole: "project_manager" } },
    { table: accounts, values: { accountRole: "employee" } },
  ]);
});

test("inactive accounts cannot be appointed as Project Managers", async () => {
  const db = createDb("super_admin", { ...employeeAccount, active: false });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project-manager-access", { projectManagerAccess: true });
    assert.equal(response.status, 409);
    assert.equal((await response.json()).message, "Activate this account before appointing a Project Manager.");
  });

  assert.equal(db.updates.length, 0);
});

test("appointed admins cannot demote Project Managers", async () => {
  const db = createDb("admin", { ...activeProjectManager });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project-manager-access", { projectManagerAccess: false });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Super User access is required.");
  });

  assert.equal(db.updates.length, 0);
});

test("appointed admins cannot deactivate a Project Manager", async () => {
  const db = createManpowerActiveDb({ target: { ...activeProjectManager }, role: "admin" });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/active", { active: false });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Only the Super User can change a Project Manager's account status.");
  });

  assert.equal(db.updates.length, 0);
});

test("the Super User can deactivate a Project Manager", async () => {
  const target = { ...activeProjectManager };
  const db = createManpowerActiveDb({ target, role: "super_admin" });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/active", { active: false });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.active, false);
  });

  assert.deepEqual(db.updates, [{ table: accounts, values: { active: false } }]);
});

test("the Super User can assign an appointed Project Manager to a project", async () => {
  const target = { ...activeProjectManager };
  const destination = { id: 5, name: "Project A", managerId: null };
  const db = createAssignmentDb(target, destination);

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project-manager", { projectId: 5 });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.projectManagerProjects, [{ id: "5", name: "Project A" }]);
  });

  assert.deepEqual(db.updates, [{ table: projects, values: { managerId: target.id } }]);
});

test("a Project Manager can be assigned to an additional project", async () => {
  const target = { ...activeProjectManager };
  const destination = { id: 6, name: "Project B", managerId: null };
  const db = createAssignmentDb(target, destination, { id: 5, name: "Project A" });

  await withManpowerApp(db, async (patch) => {
    const response = await patch("/2468/project-manager", { projectId: 6 });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body.data.projectManagerProjects, [
      { id: "5", name: "Project A" },
      { id: "6", name: "Project B" },
    ]);
  });

  assert.deepEqual(db.updates, [{ table: projects, values: { managerId: target.id } }]);
});

test("the Super User can replace a Project Manager's assignments with multiple projects", async () => {
  const target = { ...activeProjectManager };
  const db = createProjectManagerAssignmentsDb({
    target,
    projects: [
      { id: 5, name: "Project A", active: true, managerId: target.id },
      { id: 6, name: "Project B", active: true, managerId: null },
      { id: 7, name: "Project C", active: true, managerId: null },
    ],
  });

  await withManpowerApp(db, async (request) => {
    const response = await request("/2468/project-manager-assignments", { projectIds: [6, 7] }, "PUT");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.projectManagerProjects, [
      { id: "6", name: "Project B" },
      { id: "7", name: "Project C" },
    ]);
  });

  assert.deepEqual(db.updates.map(({ table, values }) => ({ table, values })), [
    { table: projects, values: { managerId: null } },
    { table: projects, values: { managerId: target.id } },
    { table: projects, values: { managerId: target.id } },
  ]);
});

test("the Super User can remove all of a Project Manager's project assignments", async () => {
  const target = { ...activeProjectManager };
  const db = createProjectManagerAssignmentsDb({
    target,
    projects: [{ id: 5, name: "Project A", active: true, managerId: target.id }],
  });

  await withManpowerApp(db, async (request) => {
    const response = await request("/2468/project-manager-assignments", { projectIds: [] }, "PUT");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data.projectManagerProjects, []);
  });

  assert.deepEqual(db.updates.map(({ table, values }) => ({ table, values })), [
    { table: projects, values: { managerId: null } },
  ]);
});

test("Project Manager bulk assignment rejects projects owned by another manager", async () => {
  const db = createProjectManagerAssignmentsDb({
    target: { ...activeProjectManager },
    projects: [{ id: 5, name: "Project A", active: true, managerId: 11 }],
  });

  await withManpowerApp(db, async (request) => {
    const response = await request("/2468/project-manager-assignments", { projectIds: [5] }, "PUT");

    assert.equal(response.status, 409);
    assert.equal((await response.json()).message, "This project already has an assigned manager.");
  });

  assert.equal(db.updates.length, 0);
});

test("appointed admins cannot bulk-assign Project Manager projects", async () => {
  const db = createProjectManagerAssignmentsDb({
    target: { ...activeProjectManager },
    projects: [{ id: 5, name: "Project A", active: true, managerId: null }],
    role: "admin",
  });

  await withManpowerApp(db, async (request) => {
    const response = await request("/2468/project-manager-assignments", { projectIds: [5] }, "PUT");

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Super User access is required.");
  });

  assert.equal(db.updates.length, 0);
});

test("a project already assigned to another manager cannot be reassigned", async () => {
  const db = createAssignmentDb(
    { ...activeProjectManager },
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
    assert.deepEqual(body.data.projectManagerProjects, []);
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
