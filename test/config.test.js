import test from "node:test";
import assert from "node:assert/strict";
import { parseAppUsers } from "../src/config.js";

test("lê múltiplos usuários do SCAGI", () => {
  const users = parseAppUsers(
    '[{"username":"admin","password":"a","role":"admin"},{"username":"supervisor","password":"c","role":"supervisor"},{"username":"vendedor","password":"b","role":"operator"}]',
    "ignorado",
    "ignorada",
  );

  assert.deepEqual(users, [
    { username: "admin", password: "a", role: "admin" },
    { username: "supervisor", password: "c", role: "supervisor" },
    { username: "vendedor", password: "b", role: "operator" },
  ]);
});

test("mantém compatibilidade com APP_USER e APP_PASSWORD", () => {
  assert.deepEqual(parseAppUsers("", "admin", "senha"), [
    { username: "admin", password: "senha", role: "admin" },
  ]);
});
