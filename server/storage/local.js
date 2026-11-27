import multer from "multer";
import { randomUUID } from "node:crypto";
import { mkdir, rename, unlink } from "node:fs/promises";
import path from "node:path";

const configuredLimit = Number(process.env.MAX_UPLOAD_BYTES || 536870912);
if (!Number.isSafeInteger(configuredLimit) || configuredLimit <= 0) {
  throw new Error("MAX_UPLOAD_BYTES must be a positive safe integer.");
}

export const maxUploadBytes = configuredLimit;
export const storageRoot = path.resolve(process.env.UPLOAD_DIR || "storage/reports");
const temporaryRoot = path.join(storageRoot, ".incoming");

export async function prepareLocalStorage() {
  await mkdir(temporaryRoot, { recursive: true });
}

const diskStorage = multer.diskStorage({
  destination: (_req, _file, callback) => callback(null, temporaryRoot),
  filename: (_req, _file, callback) => callback(null, `${randomUUID()}.upload`),
});

export const reportUpload = multer({
  storage: diskStorage,
  limits: {
    fileSize: maxUploadBytes,
    fields: 4,
    fieldSize: 4096,
  },
});

export async function commitUpload(file) {
  const storageKey = randomUUID();
  const filePath = path.join(storageRoot, `${storageKey}.data`);
  await rename(file.path, filePath);
  return { storageKey, filePath };
}

export function getStoredFilePath(storageKey) {
  if (!/^[\da-f-]{36}$/i.test(storageKey)) {
    throw new Error("Invalid storage key.");
  }
  return path.join(storageRoot, `${storageKey}.data`);
}

export async function removeLocalFile(filePath) {
  try {
    await unlink(filePath);
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }
}

export function formatFileSize(bytes) {
  if (bytes >= 1024 ** 3) return `${(bytes / (1024 ** 3)).toFixed(1)} GB`;
  if (bytes >= 1024 ** 2) return `${(bytes / (1024 ** 2)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${bytes} B`;
}
