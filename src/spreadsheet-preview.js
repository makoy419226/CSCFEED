const maxPreviewRows = 100;
const maxPreviewColumns = 12;
const maxZipEntryBytes = 64 * 1024 * 1024;
const decoder = new TextDecoder();

export function parseCsvPreview(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length && rows.length < maxPreviewRows; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') {
        cell += '"';
        index += 1;
      } else if (character === '"') {
        quoted = false;
      } else {
        cell += character;
      }
    } else if (character === '"' && cell.length === 0) {
      quoted = true;
    } else if (character === ",") {
      row.push(cell);
      cell = "";
    } else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row.slice(0, maxPreviewColumns));
      row = [];
      cell = "";
    } else {
      cell += character;
    }
  }

  if (rows.length < maxPreviewRows && (row.length || cell)) {
    row.push(cell);
    rows.push(row.slice(0, maxPreviewColumns));
  }
  return rows;
}

function normalizeZipPath(value) {
  const parts = [];
  for (const part of value.replace(/\\/g, "/").split("/")) {
    if (!part || part === ".") continue;
    if (part === "..") parts.pop();
    else parts.push(part);
  }
  return parts.join("/");
}

function findEndOfCentralDirectory(view) {
  const earliest = Math.max(0, view.byteLength - 65557);
  for (let offset = view.byteLength - 22; offset >= earliest; offset -= 1) {
    if (view.getUint32(offset, true) === 0x06054b50) return offset;
  }
  throw new Error("The spreadsheet archive is invalid.");
}

function readZipEntries(bytes) {
  const view = new DataView(bytes);
  const endOffset = findEndOfCentralDirectory(view);
  if (view.getUint16(endOffset + 4, true) !== 0 || view.getUint16(endOffset + 6, true) !== 0) {
    throw new Error("Multi-disk spreadsheet archives are not supported.");
  }
  const entryCount = view.getUint16(endOffset + 10, true);
  let entryOffset = view.getUint32(endOffset + 16, true);
  if (entryCount > 10000 || entryOffset === 0xffffffff) {
    throw new Error("The spreadsheet contains too many archive entries.");
  }

  const entries = new Map();
  for (let index = 0; index < entryCount; index += 1) {
    if (entryOffset + 46 > view.byteLength || view.getUint32(entryOffset, true) !== 0x02014b50) {
      throw new Error("The spreadsheet archive directory is invalid.");
    }
    const compression = view.getUint16(entryOffset + 10, true);
    const compressedSize = view.getUint32(entryOffset + 20, true);
    const fileNameLength = view.getUint16(entryOffset + 28, true);
    const extraLength = view.getUint16(entryOffset + 30, true);
    const commentLength = view.getUint16(entryOffset + 32, true);
    const localHeaderOffset = view.getUint32(entryOffset + 42, true);
    if (compressedSize === 0xffffffff || localHeaderOffset === 0xffffffff
      || entryOffset + 46 + fileNameLength + extraLength + commentLength > view.byteLength
      || localHeaderOffset + 30 > view.byteLength
      || view.getUint32(localHeaderOffset, true) !== 0x04034b50) {
      throw new Error("The spreadsheet archive entry is invalid.");
    }
    const fileName = decoder.decode(bytes.subarray(entryOffset + 46, entryOffset + 46 + fileNameLength));
    const localNameLength = view.getUint16(localHeaderOffset + 26, true);
    const localExtraLength = view.getUint16(localHeaderOffset + 28, true);
    const dataOffset = localHeaderOffset + 30 + localNameLength + localExtraLength;
    if (dataOffset + compressedSize > view.byteLength) {
      throw new Error("The spreadsheet archive entry is truncated.");
    }
    entries.set(normalizeZipPath(fileName), {
      compression,
      bytes: bytes.subarray(dataOffset, dataOffset + compressedSize),
    });
    entryOffset += 46 + fileNameLength + extraLength + commentLength;
  }
  return entries;
}

async function readZipEntry(entries, fileName) {
  const entry = entries.get(fileName);
  if (!entry) return null;
  if (entry.compression === 0) {
    if (entry.bytes.byteLength > maxZipEntryBytes) throw new Error("Spreadsheet preview exceeds the supported size.");
    return entry.bytes;
  }
  if (entry.compression !== 8 || typeof DecompressionStream === "undefined") {
    throw new Error("This spreadsheet compression format is not supported by this browser.");
  }

  const reader = new Blob([entry.bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw")).getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalBytes += value.byteLength;
    if (totalBytes > maxZipEntryBytes) {
      await reader.cancel();
      throw new Error("Spreadsheet preview exceeds the supported size.");
    }
    chunks.push(value);
  }

  const result = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

function parseXml(bytes) {
  const xml = new DOMParser().parseFromString(decoder.decode(bytes), "application/xml");
  if (xml.getElementsByTagName("parsererror").length) throw new Error("The spreadsheet XML is invalid.");
  return xml;
}

function descendants(element, name) {
  return Array.from(element.getElementsByTagName("*")).filter((node) => node.localName === name);
}

async function readXmlEntry(entries, fileName) {
  const bytes = await readZipEntry(entries, fileName);
  return bytes ? parseXml(bytes) : null;
}

function columnIndex(reference) {
  const letters = reference.match(/^[A-Z]+/i)?.[0]?.toUpperCase() || "";
  let value = 0;
  for (const letter of letters) value = value * 26 + letter.charCodeAt(0) - 64;
  return value - 1;
}

export async function parseXlsxPreview(arrayBuffer) {
  const entries = readZipEntries(new Uint8Array(arrayBuffer));
  const workbook = await readXmlEntry(entries, "xl/workbook.xml");
  const relationships = await readXmlEntry(entries, "xl/_rels/workbook.xml.rels");
  if (!workbook || !relationships) throw new Error("The spreadsheet is missing workbook metadata.");

  const targets = new Map(descendants(relationships, "Relationship")
    .map((relationship) => [relationship.getAttribute("Id"), relationship.getAttribute("Target")]));
  const sharedStringsXml = await readXmlEntry(entries, "xl/sharedStrings.xml");
  const sharedStrings = sharedStringsXml
    ? descendants(sharedStringsXml, "si").map((item) =>
      descendants(item, "t").map((text) => text.textContent || "").join(""),
    )
    : [];
  const sheets = [];

  for (const sheet of descendants(workbook, "sheet").slice(0, 3)) {
    const relationshipId = sheet.getAttributeNS(
      "http://schemas.openxmlformats.org/officeDocument/2006/relationships",
      "id",
    ) || sheet.getAttribute("r:id");
    const target = targets.get(relationshipId);
    if (!target) continue;

    const sheetPath = target.startsWith("/")
      ? normalizeZipPath(target)
      : normalizeZipPath(`xl/${target}`);
    const sheetXml = await readXmlEntry(entries, sheetPath);
    if (!sheetXml) continue;

    const rows = descendants(sheetXml, "row").slice(0, maxPreviewRows).map((rowNode) => {
      const row = [];
      for (const cell of descendants(rowNode, "c")) {
        const index = columnIndex(cell.getAttribute("r") || "");
        if (index < 0 || index >= maxPreviewColumns) continue;
        const type = cell.getAttribute("t");
        const value = descendants(cell, "v")[0]?.textContent || "";
        row[index] = type === "s"
          ? sharedStrings[Number(value)] || ""
          : type === "inlineStr"
            ? descendants(cell, "t").map((text) => text.textContent || "").join("")
            : type === "b"
              ? value === "1" ? "TRUE" : "FALSE"
              : value;
      }
      return row.slice(0, maxPreviewColumns).map((value) => value || "");
    });
    sheets.push({ name: sheet.getAttribute("name") || "Sheet", rows });
  }

  return sheets;
}
