import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import express from "express";
import test from "node:test";
import { authSessions } from "../../src/db/schema.js";
import { handleError } from "../errors.js";
import { createAuthRouter } from "./auth.js";

function createDb(account) {
  const insertedSessions = [];
  return {
    insertedSessions,
    select() {
      return {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() { return [account]; },
        async orderBy() { return account.projectManagerProjects || []; },
      };
    },
    delete() {
      return { async where() {} };
    },
    insert(table) {
      return {
        async values(value) {
          insertedSessions.push({ table, value });
        },
      };
    },
  };
}

async function withLoginApp(db, login) {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({ db, ready: () => true }));
  app.use(handleError);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    return await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(login),
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("appointed admins keep Punch ID sign-in and receive admin sessions", async () => {
  const db = createDb({
    id: 12,
    fullName: "Appointed Admin",
    role: "admin",
    punchId: "1234",
    active: true,
  });

  const response = await withLoginApp(db, { employeeId: "1234" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.user.role, "admin");
  assert.equal(db.insertedSessions[0].table, authSessions);
});

test("appointed admins cannot use Super User username/password sign-in", async () => {
  const db = createDb({
    id: 12,
    fullName: "Appointed Admin",
    role: "admin",
    punchId: "1234",
    active: true,
    username: "appointed",
    passwordHash: await bcrypt.hash("valid-password", 4),
  });

  const response = await withLoginApp(db, { username: "appointed", password: "valid-password" });

  assert.equal(response.status, 401);
  assert.equal(db.insertedSessions.length, 0);
});

test("appointed Project Managers sign in and receive all assigned project ids", async () => {
  const db = createDb({
    id: 15,
    fullName: "Project Manager",
    role: "project_manager",
    punchId: "4567",
    active: true,
    projectManagerProjects: [{ id: 5 }, { id: 8 }],
  });

  const response = await withLoginApp(db, { employeeId: "4567" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.user.role, "project_manager");
  assert.deepEqual(body.user.projectManagerProjectIds, ["5", "8"]);
});

test("the Super User can continue using username/password sign-in", async () => {
  const db = createDb({
    id: 1,
    fullName: "CSC Feed Super User",
    role: "super_admin",
    punchId: "0000",
    active: true,
    username: "admin",
    passwordHash: await bcrypt.hash("valid-password", 4),
  });

  const response = await withLoginApp(db, { username: "admin", password: "valid-password" });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.user.role, "super_admin");
  assert.equal(db.insertedSessions[0].table, authSessions);
});
