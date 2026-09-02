import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const MAX_SESSIONS = 500;

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

  function sweepExpired() {
    const now = Date.now();
    for (const [id, session] of sessions) {
      if (session.expiresAt <= now) sessions.delete(id);
    }
  }

  function signature(id) {
    return createHmac("sha256", secret).update(id).digest("base64url");
  }

  function create(user) {
    sweepExpired();
    while (sessions.size >= MAX_SESSIONS) sessions.delete(sessions.keys().next().value);
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

  function destroyByUsername(username) {
    for (const [id, session] of sessions) {
      if (session.username === username) sessions.delete(id);
    }
  }

  return { create, read, destroy, destroyByUsername };
}

export function createLoginRateLimiter({ maxAttempts = 5, windowMs = 15 * 60 * 1000 } = {}) {
  const attempts = new Map();

  function sweep(now = Date.now()) {
    for (const [key, entry] of attempts) {
      if (entry.resetAt <= now) attempts.delete(key);
    }
  }

  return {
    check(key) {
      sweep();
      const entry = attempts.get(key);
      if (!entry || entry.count < maxAttempts) return { allowed: true, retryAfterSeconds: 0 };
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000)) };
    },
    recordFailure(key) {
      const now = Date.now();
      sweep(now);
      const entry = attempts.get(key);
      if (entry) {
        entry.count += 1;
        return;
      }
      attempts.set(key, { count: 1, resetAt: now + windowMs });
    },
    reset(key) {
      attempts.delete(key);
    },
  };
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
