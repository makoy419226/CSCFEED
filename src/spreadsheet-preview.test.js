import assert from "node:assert/strict";
import test from "node:test";
import { parseCsvPreview } from "./spreadsheet-preview.js";

test("CSV previews preserve quoted commas and escaped quotes", () => {
  assert.deepEqual(parseCsvPreview('Name,Note\r\n"Site A","Steel, delivered"\r\n"Team ""Blue""",Ready\r\n'), [
    ["Name", "Note"],
    ["Site A", "Steel, delivered"],
    ['Team "Blue"', "Ready"],
  ]);
});

test("CSV previews stop after 100 rows", () => {
  const preview = parseCsvPreview(Array.from({ length: 150 }, (_, index) => String(index)).join("\n"));
  assert.equal(preview.length, 100);
});
