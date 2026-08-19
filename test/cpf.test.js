import test from "node:test";
import assert from "node:assert/strict";
import { formatCpf, isValidCpf, maskCpf, normalizeCpf } from "../src/cpf.js";

test("normaliza e formata CPF", () => {
  assert.equal(normalizeCpf("529.982.247-25"), "52998224725");
  assert.equal(formatCpf("52998224725"), "529.982.247-25");
  assert.equal(maskCpf("52998224725"), "***.***.247-25");
});
test("valida dígitos verificadores e rejeita sequências", () => {
  assert.equal(isValidCpf("529.982.247-25"), true);
  assert.equal(isValidCpf("529.982.247-24"), false);
  assert.equal(isValidCpf("111.111.111-11"), false);
});
