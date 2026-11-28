import { createCipheriv, createDecipheriv, randomBytes } from "node:crypto";
import { HttpError } from "./errors.js";

function getEncryptionKey() {
  const value = process.env.PASSWORD_ENCRYPTION_KEY?.trim();
  if (!value || !/^[\da-f]{64}$/i.test(value)) {
    throw new HttpError(503, "Password viewing is not configured. Set PASSWORD_ENCRYPTION_KEY to 64 hexadecimal characters.");
  }
  return Buffer.from(value, "hex");
}

export function encryptPassword(password) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", getEncryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(password, "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64url"), cipher.getAuthTag().toString("base64url"), ciphertext.toString("base64url")].join(".");
}

export function decryptPassword(value) {
  if (!value?.startsWith("v1.")) throw new HttpError(404, "This password cannot be viewed. Reset it to enable password viewing.");
  const [, ivValue, tagValue, ciphertextValue] = value.split(".");
  try {
    const decipher = createDecipheriv("aes-256-gcm", getEncryptionKey(), Buffer.from(ivValue, "base64url"));
    decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
    return Buffer.concat([
      decipher.update(Buffer.from(ciphertextValue, "base64url")),
      decipher.final(),
    ]).toString("utf8");
  } catch (error) {
    if (error instanceof HttpError) throw error;
    throw new HttpError(503, "This password could not be decrypted. Check PASSWORD_ENCRYPTION_KEY.");
  }
}
