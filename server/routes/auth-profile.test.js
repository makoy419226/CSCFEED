import assert from "node:assert/strict";
import bcrypt from "bcryptjs";
import express from "express";
import test from "node:test";
import { authCredentials, authSessions, accounts } from "../../src/db/schema.js";
import { handleError } from "../errors.js";
import { createTokenHash } from "../session-cookie.js";
import { createAuthRouter } from "./auth.js";

function readSqlParameters(sql) {
  const values = [];
  for (const chunk of sql?.queryChunks || []) {
    if (chunk?.queryChunks) values.push(...readSqlParameters(chunk));
    else if (chunk?.encoder && Object.prototype.hasOwnProperty.call(chunk, "value")) values.push(chunk.value);
  }
  return values;
}

function createDb(role, passwordHash) {
  let selectCalls = 0;
  const updates = [];
  const sessionRevocations = [];
  const db = {
    updates,
    sessionRevocations,
    select() {
      const call = ++selectCalls;
      const query = {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() {
          if (call === 1) {
            return [{
              id: 1,
              name: "Original Admin",
              role,
              punchId: role === "super_admin" ? "0000" : "1234",
              username: role === "super_admin" ? "admin" : "employee",
            }];
          }
          return [{ passwordHash }];
        },
      };
      return query;
    },
    async transaction(run) {
      return run({
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
        delete(table) {
          return {
            async where(condition) {
              sessionRevocations.push({ table, condition });
            },
          };
        },
      });
    },
  };
  return db;
}

async function withAuthApp(db, request) {
  const app = express();
  app.use(express.json());
  app.use("/api/auth", createAuthRouter({ db, ready: () => true }));
  app.use(handleError);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    return await request((body) => fetch(`http://127.0.0.1:${port}/api/auth/profile`, {
      method: "PATCH",
      headers: {
        "Content-Type": "application/json",
        cookie: "cscfeed_session=current-session",
      },
      body: JSON.stringify(body),
    }));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("admin profile changes update the name and password while revoking other sessions", async () => {
  const currentPassword = "current-password";
  const db = createDb("super_admin", await bcrypt.hash(currentPassword, 4));

  await withAuthApp(db, async (patch) => {
    const response = await patch({
      displayName: "Updated Administrator",
      currentPassword,
      newPassword: "a-strong-new-password",
    });

    assert.equal(response.status, 200);
    assert.equal((await response.json()).user.name, "Updated Administrator");
  });

  const accountUpdate = db.updates.find(({ table }) => table === accounts);
  const credentialUpdate = db.updates.find(({ table }) => table === authCredentials);
  assert.deepEqual(accountUpdate.values, { fullName: "Updated Administrator" });
  assert.equal(await bcrypt.compare("a-strong-new-password", credentialUpdate.values.passwordHash), true);
  assert.equal(db.sessionRevocations.length, 1);
  assert.equal(db.sessionRevocations[0].table, authSessions);
  assert.ok(readSqlParameters(db.sessionRevocations[0].condition).includes(createTokenHash("current-session")));
});

test("admin profile changes reject an incorrect current password", async () => {
  const db = createDb("super_admin", await bcrypt.hash("correct-password", 4));

  await withAuthApp(db, async (patch) => {
    const response = await patch({
      displayName: "Updated Administrator",
      currentPassword: "incorrect-password",
    });

    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), {
      success: false,
      message: "Current password is incorrect.",
    });
  });

  assert.equal(db.updates.length, 0);
});

test("employees cannot use the Super User profile update endpoint", async () => {
  const db = createDb("employee", "unused");

  await withAuthApp(db, async (patch) => {
    const response = await patch({
      displayName: "Updated Name",
      currentPassword: "current-password",
    });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Super User access is required.");
  });

  assert.equal(db.updates.length, 0);
});

test("appointed admins cannot change account settings", async () => {
  const db = createDb("admin", "unused");

  await withAuthApp(db, async (patch) => {
    const response = await patch({
      displayName: "Updated Administrator",
      currentPassword: "current-password",
    });

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Super User access is required.");
  });

  assert.equal(db.updates.length, 0);
});
