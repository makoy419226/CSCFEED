import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { handleError } from "../errors.js";
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
