import assert from "node:assert/strict";
import test from "node:test";
import { parseRondoniaSingleResult } from "../src/portals/rondonia.js";

test("interpreta o resultado individual exibido pelo portal de Rondônia", () => {
  const result = parseRondoniaSingleResult(`
Averbações
Dados do Servidor
SERVIDOR DE TESTE
Matrícula: 300194230-9
CPF: 000.000.000-00
Cargo: Tecnico Educacional Nivel 2
Lotação: SEDUC - TECNICOS EMERGENCIAL
Classificação: Contrato Temporario
Margem Disponível: Sem Margem
Margem Cartão: Sem Margem
Margem Cartão Benefício: Sem Margem
  `);

  assert.equal(result.hasServerSection, true);
  assert.equal(result.hasMarginSection, true);
  assert.equal(result.name, "SERVIDOR DE TESTE");
  assert.equal(result.registration, "300194230-9");
  assert.equal(result.role, "Tecnico Educacional Nivel 2");
  assert.equal(result.department, "SEDUC - TECNICOS EMERGENCIAL");
  assert.equal(result.classification, "Contrato Temporario");
  assert.equal(result.availableMargin, "Sem Margem");
  assert.equal(result.cardMargin, "Sem Margem");
  assert.equal(result.benefitCardMargin, "Sem Margem");
});
