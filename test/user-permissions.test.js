import assert from "node:assert/strict";
import test from "node:test";
import {
  canCreateUser,
  canManageUsers,
  canRemoveUser,
  canResetUserPassword,
  visibleUsersForRole,
} from "../src/user-permissions.js";

test("limita o supervisor ao gerenciamento de vendedores", () => {
  assert.equal(canManageUsers("supervisor"), true);
  assert.equal(canCreateUser("supervisor", "operator"), true);
  assert.equal(canCreateUser("supervisor", "supervisor"), false);
  assert.equal(canCreateUser("supervisor", "admin"), false);
  assert.equal(canResetUserPassword("supervisor", "operator"), true);
  assert.equal(canResetUserPassword("supervisor", "supervisor"), false);
  assert.equal(canResetUserPassword("supervisor", "admin"), false);
  assert.equal(canRemoveUser("supervisor"), false);
});

test("mantém a administração completa dos acessos com o administrador", () => {
  assert.equal(canCreateUser("admin", "operator"), true);
  assert.equal(canCreateUser("admin", "supervisor"), true);
  assert.equal(canCreateUser("admin", "admin"), false);
  assert.equal(canResetUserPassword("admin", "operator"), true);
  assert.equal(canResetUserPassword("admin", "supervisor"), true);
  assert.equal(canRemoveUser("admin"), true);
});

test("mostra somente vendedores ao supervisor", () => {
  const users = [
    { username: "admin", role: "admin" },
    { username: "supervisor1", role: "supervisor" },
    { username: "vendedor1", role: "operator" },
  ];
  assert.deepEqual(visibleUsersForRole(users, "supervisor"), [
    { username: "vendedor1", role: "operator" },
  ]);
  assert.deepEqual(visibleUsersForRole(users, "admin"), users);
});
