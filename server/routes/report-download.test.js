import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { mkdtemp, rmdir, unlink, writeFile } from "node:fs/promises";
import express from "express";
import os from "node:os";
import path from "node:path";
import { inflateRawSync } from "node:zlib";
import { handleError } from "../errors.js";

const originalUploadDir = process.env.UPLOAD_DIR;
const testStorageRoot = await mkdtemp(path.join(os.tmpdir(), "cscfeed-report-package-"));
process.env.UPLOAD_DIR = testStorageRoot;
const { getStoredFilePath } = await import("../storage/local.js");
const { createReportsRouter } = await import("./reports.js");
const storedPaths = [];

function readZipEntries(packageData) {
  const endRecord = packageData.lastIndexOf(Buffer.from([0x50, 0x4b, 0x05, 0x06]));
  const centralDirectoryOffset = packageData.readUInt32LE(endRecord + 16);
  const entries = new Map();
  let cursor = centralDirectoryOffset;

  while (packageData.readUInt32LE(cursor) === 0x02014b50) {
    const compressionMethod = packageData.readUInt16LE(cursor + 10);
    const compressedSize = packageData.readUInt32LE(cursor + 20);
    const fileNameLength = packageData.readUInt16LE(cursor + 28);
    const extraLength = packageData.readUInt16LE(cursor + 30);
    const commentLength = packageData.readUInt16LE(cursor + 32);
    const localHeaderOffset = packageData.readUInt32LE(cursor + 42);
    const fileName = packageData.toString("utf8", cursor + 46, cursor + 46 + fileNameLength);
    const localNameLength = packageData.readUInt16LE(localHeaderOffset + 26);
    const localExtraLength = packageData.readUInt16LE(localHeaderOffset + 28);
    const dataStart = localHeaderOffset + 30 + localNameLength + localExtraLength;
    const compressedData = packageData.subarray(dataStart, dataStart + compressedSize);
    const contents = compressionMethod === 8 ? inflateRawSync(compressedData) : compressedData;
    entries.set(fileName, contents);
    cursor += 46 + fileNameLength + extraLength + commentLength;
  }

  return entries;
}

after(async () => {
  for (const filePath of storedPaths) {
    try {
      await unlink(filePath);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
  }
  await rmdir(testStorageRoot);
  if (originalUploadDir === undefined) delete process.env.UPLOAD_DIR;
  else process.env.UPLOAD_DIR = originalUploadDir;
});

function createDb(role, report, attachments = []) {
  let selectCalls = 0;
  const whereConditions = [];
  return {
    whereConditions,
    select() {
      const call = ++selectCalls;
      return {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where(condition) {
          whereConditions.push({ call, condition });
          return this;
        },
        async limit() {
          if (call === 1) {
            return [{
              id: 7,
              name: role === "admin" ? "Administrator" : "Employee",
              role,
              punchId: role === "admin" ? "0000" : "1234",
              username: role,
            }];
          }
          return call === 2 && role === "admin" && report ? [report] : [];
        },
        async orderBy() {
          return attachments;
        },
      };
    },
  };
}

function createProjectExportDb(projectManagerProjectId, reportRows, attachmentRows) {
  let selectCalls = 0;
  return {
    select() {
      const call = ++selectCalls;
      return {
        from() { return this; },
        innerJoin() { return this; },
        leftJoin() { return this; },
        where() { return this; },
        async limit() {
          return [{
            id: 8,
            name: "Project Manager",
            role: "employee",
            punchId: "2468",
            username: "2468",
            projectManagerProjectId: String(projectManagerProjectId),
          }];
        },
        async orderBy() {
          return call === 2 ? reportRows : attachmentRows;
        },
      };
    },
  };
}

async function createStoredFile(contents) {
  const storageKey = randomUUID();
  const filePath = getStoredFilePath(storageKey);
  await writeFile(filePath, contents);
  storedPaths.push(filePath);
  return storageKey;
}

async function withReportsApp(db, request, resourcePath = "/19/download") {
  const app = express();
  app.use("/api/reports", createReportsRouter({ db, maxUploadBytes: 1024 }));
  app.use(handleError);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));

  try {
    const { port } = server.address();
    return await request(() => fetch(`http://127.0.0.1:${port}/api/reports${resourcePath}`, {
      headers: { cookie: "cscfeed_session=test-session" },
    }));
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => error ? reject(error) : resolve());
    });
  }
}

test("report download packages a PDF summary with every evidence file", async () => {
  const firstKey = await createStoredFile("first evidence");
  const secondKey = await createStoredFile("second evidence");
  const report = {
    id: 19,
    projectName: "Project A",
    title: "Weekly site update",
    description: "Completed foundation work.",
    uploaderName: "Project Admin",
    reportDate: "2026-11-27",
    fileName: "site-photo.jpg",
    storageKey: firstKey,
    fileSizeBytes: 15,
  };
  const attachments = [
    { fileName: "site-photo.jpg", storageKey: firstKey, fileSizeBytes: 15 },
    { fileName: "site-photo.jpg", storageKey: secondKey, fileSizeBytes: 16 },
  ];

  await withReportsApp(createDb("admin", report, attachments), async (get) => {
    const response = await get();
    const packageData = Buffer.from(await response.arrayBuffer());
    const packageEntries = packageData.toString("latin1");
    const entries = readZipEntries(packageData);

    assert.equal(response.status, 200);
    assert.match(response.headers.get("content-type"), /application\/zip/);
    assert.match(response.headers.get("content-disposition"), /Weekly_site_update-19-package\.zip/);
    assert.equal(packageData.subarray(0, 4).toString("latin1"), "PK\u0003\u0004");
    assert.ok(packageEntries.includes("report.pdf"));
    assert.ok(packageEntries.includes("evidence/site-photo.jpg"));
    assert.ok(packageEntries.includes("evidence/site-photo-2.jpg"));
    assert.equal(entries.get("report.pdf").subarray(0, 5).toString(), "%PDF-");
    assert.equal(entries.get("evidence/site-photo.jpg").toString(), "first evidence");
    assert.equal(entries.get("evidence/site-photo-2.jpg").toString(), "second evidence");
    assert.equal(packageData.subarray(-22, -18).toString("latin1"), "PK\u0005\u0006");
  });
});

test("employees cannot download a report package they do not own", async () => {
  const db = createDb("employee", {
    id: 19,
    projectName: "Project A",
    title: "Private report",
    description: "",
    uploaderName: "Another employee",
    reportDate: "2026-11-27",
    fileName: "evidence.jpg",
    storageKey: randomUUID(),
    fileSizeBytes: 12,
  });

  await withReportsApp(db, async (get) => {
    const response = await get();
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { success: false, message: "Report not found." });
    const reportFilter = db.whereConditions.find(({ call }) => call === 2);
    assert.ok(reportFilter);
  });
});

test("Project Manager project export includes a PDF and evidence for each assigned-project report", async () => {
  const firstKey = await createStoredFile("first project evidence");
  const secondKey = await createStoredFile("second project evidence");
  const reportRows = [
    {
      id: 21,
      projectId: 5,
      projectName: "Project A",
      title: "Daily progress",
      description: "First report",
      uploaderName: "Site Employee",
      reportDate: "2026-11-27",
      fileName: "first.jpg",
      storageKey: firstKey,
      fileSizeBytes: 21,
    },
    {
      id: 22,
      projectId: 5,
      projectName: "Project A",
      title: "Equipment update",
      description: "Second report",
      uploaderName: "Site Employee",
      reportDate: "2026-11-26",
      fileName: "second.pdf",
      storageKey: secondKey,
      fileSizeBytes: 22,
    },
  ];
  const attachmentRows = [
    { id: 31, reportId: 21, fileName: "first.jpg", storageKey: firstKey, fileSizeBytes: 21 },
    { id: 32, reportId: 22, fileName: "second.pdf", storageKey: secondKey, fileSizeBytes: 22 },
  ];

  await withReportsApp(
    createProjectExportDb(5, reportRows, attachmentRows),
    async (get) => {
      const response = await get();
      const archive = Buffer.from(await response.arrayBuffer());
      const entries = readZipEntries(archive);

      assert.equal(response.status, 200);
      assert.match(response.headers.get("content-disposition"), /Project_A-reports\.zip/);
      assert.equal(entries.get("21-Daily_progress/report.pdf").subarray(0, 5).toString(), "%PDF-");
      assert.equal(entries.get("21-Daily_progress/evidence/first.jpg").toString(), "first project evidence");
      assert.equal(entries.get("22-Equipment_update/report.pdf").subarray(0, 5).toString(), "%PDF-");
      assert.equal(entries.get("22-Equipment_update/evidence/second.pdf").toString(), "second project evidence");
    },
    "/project/5/export",
  );
});
