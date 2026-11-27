import path from "node:path";

const supportedExtensions = new Set([
  ".bmp",
  ".csv",
  ".doc",
  ".docx",
  ".gif",
  ".jpeg",
  ".jpg",
  ".pdf",
  ".png",
  ".rtf",
  ".txt",
  ".webp",
  ".xls",
  ".xlsx",
]);

export function sanitizeUploadFileName(originalName) {
  return path.basename(originalName.replace(/\\/g, "/"))
    .replace(/[\u0000-\u001f\u007f]/g, "")
    .trim();
}

export function isSupportedReportFile(fileName) {
  return supportedExtensions.has(path.extname(fileName).toLowerCase());
}
