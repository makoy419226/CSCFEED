import assert from "node:assert/strict";
import express from "express";
import test from "node:test";
import { handleError } from "../errors.js";
import { createReportsRouter } from "./reports.js";

function readSqlParts(sql) {
  const parts = [];
  for (const chunk of sql?.queryChunks || []) {
    if (Array.isArray(chunk)) {
      parts.push(...readSqlParts({ queryChunks: chunk }));
    } else if (chunk?.queryChunks) {
      parts.push(...readSqlParts(chunk));
    } else if (chunk?.encoder && Object.prototype.hasOwnProperty.call(chunk, "value")) {
      parts.push({ type: "parameter", value: chunk.value });
    } else if (chunk?.name) {
      parts.push({ type: "column", value: chunk.name });
    }
  }
  return parts;
}

function createDb(role, reportRows = [], accountRows = [], projectManagerProjectIds = []) {
  let selectCalls = 0;
  const whereConditions = [];
  const ids = Array.isArray(projectManagerProjectIds) ? projectManagerProjectIds : [projectManagerProjectIds];
  const reportSelectCall = role === "project_manager" ? 3 : 2;
  const db = {
    get selectCalls() { return selectCalls; },
    whereConditions,
    select() {
      const selectCall = ++selectCalls;
      return {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where(condition) {
          whereConditions.push({ selectCall, condition });
          return this;
        },
        async limit() {
          if (selectCall === 1) {
            return [{
              id: 1,
              name: "Test User",
              role,
              punchId: role === "super_admin" ? "0000" : "1234",
              username: role,
              projectManagerProjectIds: ids.map(String),
            }];
          }
          return selectCall === 2 ? accountRows : [];
        },
        async orderBy() {
          if (role === "project_manager" && selectCall === 2) return ids.map((id) => ({ id }));
          if (accountRows.length > 0 && selectCall === 3) return reportRows;
          if (selectCall === reportSelectCall) return reportRows;
          return [];
        },
      };
    },
  };
  return db;
}

async function withReportsApp(db, run) {
  const app = express();
  app.use("/api/reports", createReportsRouter({ db, maxUploadBytes: 1024 }));
  app.use(handleError);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    await run((path) => fetch(`http://127.0.0.1:${port}/api/reports${path}`, {
      headers: { cookie: "cscfeed_session=test-session" },
    }));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("employees cannot list workspace reports and file lookups remain owner-scoped", async () => {
  const listDb = createDb("employee");
  await withReportsApp(listDb, async (get) => {
    const listResponse = await get("/");

    assert.equal(listResponse.status, 403);
    assert.deepEqual(await listResponse.json(), {
      success: false,
      message: "Administrator access is required.",
    });
  });

  const fileDb = createDb("employee");
  await withReportsApp(fileDb, async (get) => {
    const fileResponse = await get("/17/file");

    assert.equal(fileResponse.status, 404);
    assert.deepEqual(await fileResponse.json(), {
      success: false,
      message: "Report file not found.",
    });
    assert.equal(fileDb.selectCalls, 2);
    const fileFilter = fileDb.whereConditions.find(({ selectCall }) => selectCall === 2);
    const sqlParts = readSqlParts(fileFilter.condition);
    assert.ok(sqlParts.some((part) => part.type === "column" && part.value === "uploaded_by"));
    assert.ok(sqlParts.some((part) => part.type === "parameter" && part.value === 1));
  });
});

test("employees can see their own reports in the dated log", async () => {
  const db = createDb("employee", [{
    id: 17,
    projectId: 3,
    projectName: "Project A",
    title: "Daily progress",
    description: "Site update",
    uploaderName: "Test User",
    reportDate: "2026-11-25",
    fileName: "progress.pdf",
    fileSizeBytes: 123,
  }]);

  await withReportsApp(db, async (get) => {
    const response = await get("/mine");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].title, "Daily progress");
    assert.equal(body.data[0].date, "2026-11-25");
    const ownReportsFilter = db.whereConditions.find(({ selectCall }) => selectCall === 2);
    const sqlParts = readSqlParts(ownReportsFilter.condition);
    assert.ok(sqlParts.some((part) => part.type === "column" && part.value === "uploaded_by"));
    assert.ok(sqlParts.some((part) => part.type === "parameter" && part.value === 1));
  });
});

test("administrators can list reports", async () => {
  const db = createDb("admin");

  await withReportsApp(db, async (get) => {
    const response = await get("/");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: [],
      maxUploadBytes: 1024,
    });
  });
});

test("the Super User can list all reports", async () => {
  const db = createDb("super_admin");

  await withReportsApp(db, async (get) => {
    const response = await get("/");

    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), {
      success: true,
      data: [],
      maxUploadBytes: 1024,
    });
  });
});

test("Project Managers only list reports from their assigned projects", async () => {
  const db = createDb("project_manager", [{
    id: 17,
    projectId: 4,
    projectName: "Project A",
    title: "Daily progress",
    description: "Site update",
    uploaderName: "Another Employee",
    reportDate: "2026-11-25",
    fileName: "progress.pdf",
    fileSizeBytes: 123,
  }], [], [3, 4]);

  await withReportsApp(db, async (get) => {
    const response = await get("/managed");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.length, 1);
    const projectScope = db.whereConditions.find(({ selectCall }) => selectCall === 3);
    const sqlParts = readSqlParts(projectScope.condition);
    assert.ok(sqlParts.some((part) => part.type === "column" && part.value === "project_id"));
    assert.ok(sqlParts.some((part) => part.type === "parameter" && part.value === 3));
    assert.ok(sqlParts.some((part) => part.type === "parameter" && part.value === 4));
  });
});

test("employees without a Project Manager assignment cannot use the managed report list", async () => {
  const db = createDb("employee");

  await withReportsApp(db, async (get) => {
    const response = await get("/managed");

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "Project Manager access is required.");
    assert.equal(db.selectCalls, 1);
  });
});

test("Project Managers cannot download or export reports from another project", async () => {
  const fileDb = createDb("project_manager", [], [], [3, 4]);
  await withReportsApp(fileDb, async (get) => {
    const response = await get("/17/file");

    assert.equal(response.status, 404);
    const fileScope = fileDb.whereConditions.find(({ selectCall }) => selectCall === 3);
    const sqlParts = readSqlParts(fileScope.condition);
    assert.ok(sqlParts.some((part) => part.type === "column" && part.value === "project_id"));
    assert.ok(sqlParts.some((part) => part.type === "parameter" && part.value === 3));
  });

  const exportDb = createDb("project_manager", [], [], [3, 4]);
  await withReportsApp(exportDb, async (get) => {
    const response = await get("/project/7/export");

    assert.equal(response.status, 403);
    assert.equal((await response.json()).message, "You can only export reports from your assigned projects.");
    assert.equal(exportDb.selectCalls, 2);
  });
});

test("administrators can view one employee's report log", async () => {
  const db = createDb("admin", [{
    id: 17,
    projectId: 3,
    projectName: "Project A",
    title: "Daily progress",
    description: "Site update",
    uploaderName: "Employee",
    reportDate: "2026-11-25",
    fileName: "progress.pdf",
    fileSizeBytes: 123,
  }], [{ id: 42 }]);

  await withReportsApp(db, async (get) => {
    const response = await get("/by-uploader/1234");
    const body = await response.json();

    assert.equal(response.status, 200);
    assert.equal(body.data.length, 1);
    assert.equal(body.data[0].date, "2026-11-25");
    const employeeFilter = db.whereConditions.find(({ selectCall }) => selectCall === 3);
    const sqlParts = readSqlParts(employeeFilter.condition);
    assert.ok(sqlParts.some((part) => part.type === "column" && part.value === "uploaded_by"));
    assert.ok(sqlParts.some((part) => part.type === "parameter" && part.value === 42));
  });
});

test("employees cannot open the administrator employee-report log endpoint", async () => {
  const db = createDb("employee");

  await withReportsApp(db, async (get) => {
    const response = await get("/by-uploader/1234");

    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), {
      success: false,
      message: "Administrator access is required.",
    });
    assert.equal(db.selectCalls, 1);
  });
});
