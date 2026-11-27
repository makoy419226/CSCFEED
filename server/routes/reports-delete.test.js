import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { reportFiles, reports } from "../../src/db/schema.js";
import { handleError } from "../errors.js";
import { createReportsRouter } from "./reports.js";

function createDb(role, reportRows = [], attachmentRows = []) {
  const deletedTables = [];
  const selectedTables = [];
  let transactionCount = 0;
  const tx = {
    select() {
      let table;
      return {
        from(value) { table = value; selectedTables.push(value); return this; },
        where() { return table === reportFiles ? Promise.resolve(attachmentRows) : this; },
        async for() { return table === reports ? reportRows : attachmentRows; },
      };
    },
    delete(table) {
      return {
        where() { deletedTables.push(table); return this; },
        async returning() {
          return table === reports ? reportRows.map(({ id }) => ({ id })) : [];
        },
      };
    },
  };
  const db = {
    deletedTables,
    selectedTables,
    get transactionCount() { return transactionCount; },
    select() {
      return {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() {
          return [{
            id: role === "super_admin" ? 1 : 2,
            name: "Test User",
            role,
            punchId: role === "super_admin" ? "0000" : "1234",
            username: role,
          }];
        },
      };
    },
    async transaction(callback) {
      transactionCount += 1;
      return callback(tx);
    },
  };
  return db;
}

async function withReportsApp(db, run) {
  const app = express();
  app.use(express.json());
  app.use("/api/reports", createReportsRouter({ db, maxUploadBytes: 1024 }));
  app.use(handleError);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    await run((path, body) => fetch(`http://127.0.0.1:${port}/api/reports${path}`, {
      method: "DELETE",
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

const reportRows = [
  { id: 17, storageKey: "11111111-1111-4111-8111-111111111111" },
  { id: 18, storageKey: "22222222-2222-4222-8222-222222222222" },
];

test("only the Super User can permanently delete selected reports", async () => {
  const db = createDb("admin", reportRows);

  await withReportsApp(db, async (remove) => {
    const response = await remove("/selected", { ids: [17] });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Super User access is required.");
  });

  assert.equal(db.transactionCount, 0);
  assert.deepEqual(db.deletedTables, []);
});

test("the Super User deletes selected reports and their evidence records", async () => {
  const attachmentRows = [
    { storageKey: "11111111-1111-4111-8111-111111111111" },
    { storageKey: "33333333-3333-4333-8333-333333333333" },
    { storageKey: "22222222-2222-4222-8222-222222222222" },
  ];
  const db = createDb("super_admin", reportRows, attachmentRows);

  await withReportsApp(db, async (remove) => {
    const response = await remove("/selected", { ids: ["17", "18"] });
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.deepEqual(body.data, { deletedCount: 2, cleanupPendingCount: 0 });
  });

  assert.equal(db.transactionCount, 1);
  assert.deepEqual(db.deletedTables, [reports]);
  assert.ok(db.selectedTables.includes(reportFiles));
});

test("selected report deletion rejects missing reports without deleting any", async () => {
  const db = createDb("super_admin", [reportRows[0]]);

  await withReportsApp(db, async (remove) => {
    const response = await remove("/selected", { ids: [17, 18] });

    assert.equal(response.status, 404);
    assert.equal((await response.json()).message, "One or more selected reports were not found.");
  });

  assert.deepEqual(db.deletedTables, []);
});
