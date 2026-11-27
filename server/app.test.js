import assert from "node:assert/strict";
import test from "node:test";
import { createApp } from "./app.js";

test("development trusts only loopback proxies", () => {
  const app = createApp({
    db: {},
    ready: () => true,
    maxUploadBytes: 1024,
  });

  assert.equal(app.get("trust proxy"), process.env.NODE_ENV === "production" ? 1 : "loopback");
});

test("the login limiter accepts forwarded IPs from the local development proxy", async () => {
  const app = createApp({
    db: {},
    ready: () => true,
    maxUploadBytes: 1024,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/auth/login`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Forwarded-For": "203.0.113.20",
      },
      body: "{}",
    });

    assert.equal(response.status, 400);
    assert.equal((await response.json()).success, false);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});

test("unknown Express routes return an Express-specific not-found message", async () => {
  const app = createApp({
    db: {},
    ready: () => true,
    maxUploadBytes: 1024,
  });
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    const response = await fetch(`http://127.0.0.1:${port}/api/not-a-route`);

    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), {
      success: false,
      message: "Express route not found.",
    });
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
});
