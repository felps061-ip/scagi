import test from "node:test";
import assert from "node:assert/strict";
import {
  createSessionStore,
  createLoginRateLimiter,
  credentialsMatch,
  findUserByCredentials,
  parseCookies,
} from "../src/security.js";

test("assina, lê e invalida sessões", () => {
  const store = createSessionStore("segredo-de-teste-com-mais-de-trinta-e-dois-caracteres");
  const token = store.create("admin");
  assert.equal(store.read(token).username, "admin");
  assert.equal(store.read(`${token}alterado`), null);
  store.destroy(token);
  assert.equal(store.read(token), null);
});
test("limita tentativas repetidas de login", () => {
  const limiter = createLoginRateLimiter({ maxAttempts: 2, windowMs: 60_000 });
  assert.equal(limiter.check("ip").allowed, true);
  limiter.recordFailure("ip");
  limiter.recordFailure("ip");
  assert.equal(limiter.check("ip").allowed, false);
  limiter.reset("ip");
  assert.equal(limiter.check("ip").allowed, true);
});
test("compara credenciais e interpreta cookies", () => {
  assert.equal(credentialsMatch("admin", "senha", "admin", "senha"), true);
  assert.equal(credentialsMatch("admin", "errada", "admin", "senha"), false);
  assert.deepEqual(parseCookies("a=1; scagi_session=abc.def"), { a: "1", scagi_session: "abc.def" });
});

test("autentica usuários diferentes e preserva o perfil na sessão", () => {
  const users = [
    { username: "admin", password: "senha-admin", role: "admin" },
    { username: "vendedor1", password: "senha-vendedor", role: "operator" },
  ];
  const seller = findUserByCredentials(users, "vendedor1", "senha-vendedor");
  assert.equal(seller.role, "operator");
  assert.equal(findUserByCredentials(users, "vendedor1", "senha-errada"), null);

  const store = createSessionStore("segredo-de-teste-com-mais-de-trinta-e-dois-caracteres");
  const token = store.create(seller);
  assert.deepEqual(
    { username: store.read(token).username, role: store.read(token).role },
    { username: "vendedor1", role: "operator" },
  );
});
