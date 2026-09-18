import assert from "node:assert/strict";
import test from "node:test";
import { MatoGrossoDoSulPortal, readMatoGrossoDoSulDetails, readMatoGrossoDoSulRows } from "../src/portals/mato-grosso-sul.js";

test("MS retorna à pesquisa na mesma página e limpa os campos", async () => {
  const portal = new MatoGrossoDoSulPortal({ baseUrl: "https://example.org", username: "test", password: "test" });
  portal.searchUrl = "https://example.org/v3/consultarMargem?acao=iniciar";
  const cleared = [];
  let navigated;
  portal.page = {
    goto: async (url) => { navigated = url; },
    url: () => navigated,
    locator: (selector) => ({ first() { return this; },
      isVisible: async () => !selector.includes('input[name="username"]'),
      waitFor: async () => {}, fill: async (value) => { assert.equal(value, ""); cleared.push(selector); },
    }),
  };
  const page = portal.page;
  await portal.returnToMarginSearch();
  assert.equal(navigated, portal.searchUrl);
  assert.equal(portal.page, page);
  assert.equal(cleared.length, 3);
  assert.equal(portal.state, "connected");
});

test("MS detecta sessão expirada ao retornar à pesquisa", async () => {
  const portal = new MatoGrossoDoSulPortal({ baseUrl: "https://example.org", username: "test", password: "test" });
  portal.searchUrl = "https://example.org/v3/consultarMargem";
  portal.page = { goto: async () => {}, url: () => "https://example.org/v3/autenticarUsuario" };
  await assert.rejects(portal.returnToMarginSearch(), { code: "PORTAL_SESSION_EXPIRED" });
  assert.equal(portal.state, "disconnected");
  assert.equal(portal.searchUrl, null);
});

test("MS preserva resultado e aguarda retorno à pesquisa após o CAPTCHA", async () => {
  const portal = new MatoGrossoDoSulPortal({ baseUrl: "https://example.org", username: "test", password: "test" });
  portal.pendingQuery = { cpf: "52998224725", registration: "12345" };
  const events = [];
  const entries = [
    { type: "dt", text: "CPF:" }, { type: "dd", text: "52998224725" },
    { type: "dt", text: "Servidor:" }, { type: "dd", text: "12345 - TESTE" },
    { type: "dt", text: "Margem Disponível:" }, { type: "dd", text: "R$ 10,00" },
  ];
  portal.page = { waitForNavigation: async () => {}, locator: () => ({
    first() { return this; }, fill: async () => {}, press: async () => {}, click: async () => {}, waitFor: async () => {},
    evaluateAll: async () => { events.push("read"); return entries; },
  }) };
  portal.returnToMarginSearch = async () => { assert.equal(portal.pendingQuery, null); events.push("return"); };
  const result = await portal.submitQueryCaptcha("test");
  assert.deepEqual(events, ["read", "return"]);
  assert.equal(result.employments[0].margins[0].value, "R$ 10,00");
});

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
