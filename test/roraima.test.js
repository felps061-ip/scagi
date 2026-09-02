import test from "node:test";
import assert from "node:assert/strict";
import {
  parseRoraimaMargin,
  parseRoraimaServerRows,
  RoraimaPortal,
} from "../src/portals/roraima.js";

test("usa a entrada estável /grid/login.seam de Roraima", () => {
  const portal = new RoraimaPortal({
    baseUrl: "https://consignado.gridsoftware.com.br/grid",
    loginPath: "/login.seam",
  });
  assert.equal(
    portal.loginUrl(),
    "https://consignado.gridsoftware.com.br/grid/login.seam",
  );
});

test("extrai a margem de empréstimo exibida pelo portal de Roraima", () => {
  assert.equal(parseRoraimaMargin("Código 0810 Margem: R$ 1.234,56"), "1.234,56");
  assert.equal(parseRoraimaMargin("Margem: Sem Margem"), "Sem Margem");
  assert.equal(parseRoraimaMargin("Nenhum resultado"), null);
});

test("normaliza as colunas da tabela de servidores de Roraima", () => {
  assert.deepEqual(
    parseRoraimaServerRows([[" 52998224725 ", " CLIENTE TESTE ", " 0043005149 ", " 03/2024 ", "Selecionar"]]),
    [{
      cpf: "52998224725",
      name: "CLIENTE TESTE",
      registration: "0043005149",
      lastPayroll: "03/2024",
    }],
  );
});
