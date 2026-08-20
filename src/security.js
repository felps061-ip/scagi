import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;

function safeEqual(left, right) {
  const leftBuffer = Buffer.from(String(left));
  const rightBuffer = Buffer.from(String(right));
  if (leftBuffer.length !== rightBuffer.length) return false;
  return timingSafeEqual(leftBuffer, rightBuffer);
}
export function credentialsMatch(inputUser, inputPassword, expectedUser, expectedPassword) {
  return safeEqual(inputUser, expectedUser) && safeEqual(inputPassword, expectedPassword);
}

export function findUserByCredentials(users, username, password) {
  return users.find((user) => (
    credentialsMatch(username, password, user.username, user.password)
  )) || null;
}

export function createSessionStore(secret) {
  const sessions = new Map();

  function signature(id) {
    return createHmac("sha256", secret).update(id).digest("base64url");
  }

  function create(user) {
    const id = randomBytes(32).toString("base64url");
    const identity = typeof user === "string"
      ? { username: user, role: "operator" }
      : { username: user.username, role: user.role };
    sessions.set(id, { ...identity, expiresAt: Date.now() + SESSION_TTL_MS });
    return `${id}.${signature(id)}`;
  }

  function read(token) {
    if (!token) return null;
    const separator = token.lastIndexOf(".");
    if (separator < 1) return null;

    const id = token.slice(0, separator);
    const suppliedSignature = token.slice(separator + 1);
    if (!safeEqual(suppliedSignature, signature(id))) return null;

    const session = sessions.get(id);
    if (!session || session.expiresAt <= Date.now()) {
      sessions.delete(id);
      return null;
    }

    return session;
  }

  function destroy(token) {
    const id = token?.slice(0, token.lastIndexOf("."));
    if (id) sessions.delete(id);
  }

  return { create, read, destroy };
}

export function parseCookies(cookieHeader = "") {
  return Object.fromEntries(
    cookieHeader
      .split(";")
      .map((part) => part.trim())
      .filter(Boolean)
      .map((part) => {
        const separator = part.indexOf("=");
        if (separator === -1) return [part, ""];
        return [part.slice(0, separator), decodeURIComponent(part.slice(separator + 1))];
      }),
  );
}

export function sessionCookie(token, secure) {
  const parts = [
    `scagi_session=${encodeURIComponent(token)}`,
    "HttpOnly",
    "Path=/",
    "SameSite=Strict",
    `Max-Age=${SESSION_TTL_MS / 1000}`,
  ];
  if (secure) parts.push("Secure");
  return parts.join("; ");
}

export function expiredSessionCookie(secure) {
  return sessionCookie("", secure).replace(`Max-Age=${SESSION_TTL_MS / 1000}`, "Max-Age=0");
}
