import test from "node:test";
import assert from "node:assert/strict";
import { normalizeRegistration } from "../src/registration.js";

test("remove hífen e pontuação da matrícula", () => {
  assert.equal(normalizeRegistration("214860-9"), "2148609");
  assert.equal(normalizeRegistration(" 21.4860 / 9 "), "2148609");
});
