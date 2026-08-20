import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createUserStore } from "../src/user-store.js";

test("cria, autentica, redefine e remove vendedores com persistência", () => {
  const directory = mkdtempSync(join(tmpdir(), "scagi-users-"));
  const filePath = join(directory, "users.json");
  try {
    const store = createUserStore({
      filePath,
      seedUsers: [{ username: "admin", password: "senha-admin", role: "admin" }],
    });
    store.createSeller("Maria.Silva", "senha-inicial");

    assert.equal(store.authenticate("maria.silva", "senha-inicial").role, "operator");
    assert.equal(readFileSync(filePath, "utf8").includes("senha-inicial"), false);

    store.resetPassword("maria.silva", "senha-alterada");
    assert.equal(store.authenticate("maria.silva", "senha-inicial"), null);
    assert.equal(store.authenticate("maria.silva", "senha-alterada").username, "maria.silva");

    store.remove("maria.silva");
    assert.deepEqual(store.list().map(({ username }) => username), ["admin"]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test("protege o administrador e rejeita usuário duplicado", () => {
  const directory = mkdtempSync(join(tmpdir(), "scagi-users-"));
  try {
    const store = createUserStore({
      filePath: join(directory, "users.json"),
      seedUsers: [{ username: "admin", password: "senha-admin", role: "admin" }],
    });
    assert.throws(() => store.createSeller("admin", "outra-senha"), { code: "USER_EXISTS" });
    assert.throws(() => store.remove("admin"), { code: "ADMIN_PROTECTED" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
