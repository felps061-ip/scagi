import assert from "node:assert/strict";
import test from "node:test";
import { readMatoGrossoDoSulDetails, readMatoGrossoDoSulRows } from "../src/portals/mato-grosso-sul.js";

test("mantém somente matrículas do MS que possuem margem positiva", () => {
  const result = readMatoGrossoDoSulRows([
    ["100000-1", "JOÃO DA SILVA", "123.456.789-09", "Sem margem"],
    ["200000-2", "JOÃO DA SILVA", "123.456.789-09", "Margem disponível", "R$ 1.234,56", "Margem Cartão", "R$ 200,00"],
  ], "12345678909");

  assert.equal(result.length, 1);
  assert.equal(result[0].registration, "200000-2");
  assert.deepEqual(result[0].margins.map((margin) => margin.value), ["R$ 1.234,56", "R$ 200,00"]);
});

test("respeita a matrícula opcional informada para o MS", () => {
  const result = readMatoGrossoDoSulRows([
    ["200000-2", "JOÃO DA SILVA", "123.456.789-09", "R$ 1.234,56"],
  ], "12345678909", "2000002");

  assert.equal(result.length, 1);
  assert.equal(result[0].registration, "200000-2");
});

test("lê o resultado detalhado atual do eConsig/MS", () => {
  const result = readMatoGrossoDoSulDetails([
    { type: "dt", text: "Órgão:" }, { type: "dd", text: "25 - SED (Secretaria de Estado de Educacao)" },
    { type: "dt", text: "Servidor:" }, { type: "dd", text: "129423021 - VANESSA ROSSATO MAGALHAES" },
    { type: "dt", text: "CPF:" }, { type: "dd", text: "957.479.581-00" },
    { type: "dt", text: "Categoria:" }, { type: "dd", text: "ESTATUTARIO - Ativo" },
    { type: "dt", text: "Margem Disponível:" }, { type: "dd", text: "R$ 310,96" },
  ], "95747958100");

  assert.equal(result.length, 1);
  assert.equal(result[0].name, "VANESSA ROSSATO MAGALHAES");
  assert.equal(result[0].registration, "129423021");
  assert.equal(result[0].details.categoria, "ESTATUTARIO - Ativo");
  assert.equal(result[0].margins[0].value, "R$ 310,96");
});
