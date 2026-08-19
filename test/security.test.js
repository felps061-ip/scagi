import test from "node:test";
import assert from "node:assert/strict";
import { createSessionStore, credentialsMatch, parseCookies } from "../src/security.js";

test("assina, lê e invalida sessões", () => {
  const store = createSessionStore("segredo-de-teste-com-mais-de-trinta-e-dois-caracteres");
  const token = store.create("admin");
  assert.equal(store.read(token).username, "admin");
  assert.equal(store.read(`${token}alterado`), null);
  store.destroy(token);
  assert.equal(store.read(token), null);
});
test("compara credenciais e interpreta cookies", () => {
  assert.equal(credentialsMatch("admin", "senha", "admin", "senha"), true);
  assert.equal(credentialsMatch("admin", "errada", "admin", "senha"), false);
  assert.deepEqual(parseCookies("a=1; scagi_session=abc.def"), { a: "1", scagi_session: "abc.def" });
});
