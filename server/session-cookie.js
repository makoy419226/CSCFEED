import { createHash, randomBytes } from "node:crypto";

const cookieName = "cscfeed_session";
const lifetimeSeconds = 8 * 60 * 60;

export function createSessionToken() {
  return randomBytes(32).toString("base64url");
}

export function createTokenHash(token) {
  return createHash("sha256").update(token).digest("hex");
}

export function setSessionCookie(res, token) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=${token}; Path=/; HttpOnly; SameSite=Strict; Max-Age=${lifetimeSeconds}${secure}`,
  );
}

export function clearSessionCookie(res) {
  const secure = process.env.NODE_ENV === "production" ? "; Secure" : "";
  res.setHeader(
    "Set-Cookie",
    `${cookieName}=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secure}`,
  );
}

export function getSessionExpiry() {
  return new Date(Date.now() + lifetimeSeconds * 1000);
}
