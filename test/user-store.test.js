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
    store.createSeller("Maria.Silva", "SenhaInicial1");
    store.createUser("supervisor1", "SenhaSupervisor1", "supervisor");

    assert.equal(store.authenticate("maria.silva", "SenhaInicial1").role, "operator");
    assert.equal(store.authenticate("supervisor1", "SenhaSupervisor1").role, "supervisor");
    assert.equal(readFileSync(filePath, "utf8").includes("SenhaInicial1"), false);

    store.resetPassword("maria.silva", "SenhaAlterada1");
    assert.equal(store.authenticate("maria.silva", "SenhaInicial1"), null);
    assert.equal(store.authenticate("maria.silva", "SenhaAlterada1").username, "maria.silva");

    store.remove("maria.silva");
    assert.deepEqual(store.list().map(({ username }) => username), ["admin", "supervisor1"]);
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
    assert.throws(() => store.createSeller("admin", "OutraSenha1"), { code: "USER_EXISTS" });
    assert.throws(() => store.createUser("admin2", "OutraSenha1", "admin"), {
      code: "INVALID_USER_ROLE",
    });
    assert.throws(() => store.remove("admin"), { code: "ADMIN_PROTECTED" });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
