import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { accounts, authCredentials, authSessions, reports } from "../../src/db/schema.js";
import { handleError } from "../errors.js";
import { createManpowerRouter } from "./manpower.js";

function createDb(role, target, reportRows = []) {
  const deletedTables = [];
  const tx = {
    select() {
      let table;
      return {
        from(value) { table = value; return this; },
        where() { return this; },
        async for() {
          if (table === accounts) return target ? [target] : [];
          if (table === reports) return reportRows;
          return [];
        },
      };
    },
    delete(table) {
      return {
        where() { deletedTables.push(table); return this; },
        async returning() {
          return table === accounts && target ? [{ id: target.id }] : [];
        },
      };
    },
  };
  let identityLookups = 0;
  const db = {
    deletedTables,
    select() {
      identityLookups += 1;
      return {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() {
          return identityLookups === 1 ? [{
            id: role === "super_admin" ? 1 : 2,
            name: "Test User",
            role,
            punchId: role === "super_admin" ? "0000" : "1234",
            username: role,
          }] : [];
        },
      };
    },
    async transaction(callback) {
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
    await run((path) => fetch(`http://127.0.0.1:${port}/api/manpower${path}`, {
      method: "DELETE",
      headers: { cookie: "cscfeed_session=test-session" },
    }));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

const employeeAccount = {
  id: 8,
  punchId: "2468",
  fullName: "Site Employee",
  designation: "Engineer",
  accountRole: "employee",
  active: true,
};

test("only the Super User can delete a manpower account", async () => {
  const db = createDb("admin", employeeAccount);

  await withManpowerApp(db, async (remove) => {
    const response = await remove("/2468");

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Super User access is required.");
  });

  assert.deepEqual(db.deletedTables, []);
});

test("the Super User can delete an appointed admin and preserve report attribution", async () => {
  const appointedAdmin = { ...employeeAccount, accountRole: "admin" };
  const db = createDb("super_admin", appointedAdmin, [{ id: 17 }, { id: 18 }]);

  await withManpowerApp(db, async (remove) => {
    const response = await remove("/2468");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, {
      name: "Site Employee",
      punchId: "2468",
      preservedReportCount: 2,
    });
  });

  assert.deepEqual(db.deletedTables, [authSessions, authCredentials, accounts]);
});

test("the Super User account cannot be deleted", async () => {
  const superUser = { ...employeeAccount, punchId: "0000", accountRole: "super_admin" };
  const db = createDb("super_admin", superUser);

  await withManpowerApp(db, async (remove) => {
    const response = await remove("/0000");

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "The Super User account cannot be deleted.");
  });

  assert.deepEqual(db.deletedTables, []);
});
