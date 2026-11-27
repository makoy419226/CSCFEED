import assert from "node:assert/strict";
import test from "node:test";
import { isSupportedReportFile, sanitizeUploadFileName } from "./report-files.js";

test("report uploads accept common image, PDF, Word, and Excel formats", () => {
  for (const fileName of [
    "site-photo.JPG",
    "report.pdf",
    "memo.doc",
    "memo.docx",
    "tracker.xls",
    "tracker.xlsx",
    "notes.csv",
    "notes.txt",
  ]) {
    assert.equal(isSupportedReportFile(fileName), true, fileName);
  }
});

test("report uploads reject unsupported active document formats", () => {
  assert.equal(isSupportedReportFile("preview.svg"), false);
  assert.equal(isSupportedReportFile("script.html"), false);
  assert.equal(isSupportedReportFile("unknown"), false);
});

test("upload filenames discard directory components and control characters", () => {
  assert.equal(sanitizeUploadFileName("C:\\temp\\report\u0000.pdf"), "report.pdf");
});
