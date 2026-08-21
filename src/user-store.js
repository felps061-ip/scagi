import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { PortalError } from "./portals/errors.js";

const USERNAME_PATTERN = /^[a-z0-9._-]{3,40}$/;
const CREATABLE_ROLES = new Set(["operator", "supervisor"]);

function normalizeUsername(value) {
  return String(value || "").trim().toLowerCase();
}

function validateUsername(username) {
  if (!USERNAME_PATTERN.test(username)) {
    throw new PortalError(
      "INVALID_USERNAME",
      "O usuário deve ter de 3 a 40 caracteres e usar apenas letras, números, ponto, hífen ou sublinhado.",
      400,
    );
  }
}

function validatePassword(password) {
  if (String(password || "").length < 8) {
    throw new PortalError("WEAK_PASSWORD", "A senha deve ter pelo menos 8 caracteres.", 400);
  }
}

function hashPassword(password) {
  const salt = randomBytes(16).toString("hex");
  const hash = scryptSync(password, salt, 64).toString("hex");
  return { salt, hash };
}

function passwordMatches(password, user) {
  const supplied = scryptSync(String(password || ""), user.salt, 64);
  const expected = Buffer.from(user.passwordHash, "hex");
  return supplied.length === expected.length && timingSafeEqual(supplied, expected);
}

function publicUser(user) {
  return user
    ? { username: user.username, role: user.role, createdAt: user.createdAt }
    : null;
}

export function createUserStore({ filePath, seedUsers }) {
  let users = [];
  try {
    users = JSON.parse(readFileSync(filePath, "utf8"));
    if (!Array.isArray(users)) users = [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  for (const seed of seedUsers) {
    const username = normalizeUsername(seed.username);
    if (!users.some((user) => user.username === username)) {
      const password = hashPassword(seed.password);
      users.push({
        username,
        role: ["admin", "supervisor"].includes(seed.role) ? seed.role : "operator",
        passwordHash: password.hash,
        salt: password.salt,
        createdAt: new Date().toISOString(),
      });
    }
  }

  function persist() {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(users, null, 2)}\n`, { mode: 0o600 });
  }

  persist();

  return {
    list() {
      return users.map(({ username, role, createdAt }) => ({ username, role, createdAt }));
    },

    get(usernameValue) {
      return publicUser(
        users.find((candidate) => candidate.username === normalizeUsername(usernameValue)),
      );
    },

    authenticate(username, password) {
      const user = users.find((candidate) => candidate.username === normalizeUsername(username));
      if (!user || !passwordMatches(password, user)) return null;
      return { username: user.username, role: user.role };
    },

    createUser(usernameValue, password, roleValue = "operator") {
      const username = normalizeUsername(usernameValue);
      const role = String(roleValue || "operator").trim().toLowerCase();
      validateUsername(username);
      validatePassword(password);
      if (!CREATABLE_ROLES.has(role)) {
        throw new PortalError(
          "INVALID_USER_ROLE",
          "O perfil deve ser vendedor ou supervisor.",
          400,
        );
      }
      if (users.some((user) => user.username === username)) {
        throw new PortalError("USER_EXISTS", "Esse usuário já existe.", 409);
      }
      const credentials = hashPassword(password);
      const user = {
        username,
        role,
        passwordHash: credentials.hash,
        salt: credentials.salt,
        createdAt: new Date().toISOString(),
      };
      users.push(user);
      persist();
      return publicUser(user);
    },

    createSeller(usernameValue, password) {
      return this.createUser(usernameValue, password, "operator");
    },

    resetPassword(usernameValue, password) {
      validatePassword(password);
      const username = normalizeUsername(usernameValue);
      const user = users.find((candidate) => candidate.username === username);
      if (!user) throw new PortalError("USER_NOT_FOUND", "Usuário não encontrado.", 404);
      const credentials = hashPassword(password);
      user.passwordHash = credentials.hash;
      user.salt = credentials.salt;
      persist();
      return publicUser(user);
    },

    remove(usernameValue) {
      const username = normalizeUsername(usernameValue);
      const user = users.find((candidate) => candidate.username === username);
      if (!user) throw new PortalError("USER_NOT_FOUND", "Usuário não encontrado.", 404);
      if (user.role === "admin") {
        throw new PortalError("ADMIN_PROTECTED", "O administrador principal não pode ser removido.", 409);
      }
      users = users.filter((candidate) => candidate.username !== username);
      persist();
    },
  };
}
