import test from "node:test";
import assert from "node:assert/strict";
import { createPortalService } from "../src/portal-service.js";
import { PortalError } from "../src/portals/errors.js";

const portalDefinitions = [
  {
    id: "gov-sp-primary",
    queryPortalId: "portal-consignado",
    name: "Gov SP · Acesso 1",
    governments: ["São Paulo", "PMESP"],
    mockAgency: "PMESP",
    mockDelay: 0,
  },
  {
    id: "gov-sp-secondary",
    queryPortalId: "portal-consignado",
    name: "Gov SP · Acesso 2",
    governments: ["São Paulo", "PMESP"],
    mockAgency: "PMESP",
    mockDelay: 0,
  },
  {
    id: "prefeitura-sao-paulo-primary",
    queryPortalId: "prefeitura-sao-paulo",
    name: "Prefeitura de São Paulo",
    governments: ["Prefeitura de São Paulo"],
    mockAgency: "PREFEITURA DE SÃO PAULO",
    mockDelay: 0,
  },
  {
    id: "piaui-primary",
    adapter: "consigfacil",
    queryPortalId: "piaui",
    name: "Governo do Piauí",
    governments: ["Piauí"],
    queryFields: ["registration"],
    mockAgency: "GOVERNO DO ESTADO DO PIAUÍ",
    mockDelay: 0,
  },
  {
    id: "pernambuco-primary",
    adapter: "consigfacil",
    queryPortalId: "pernambuco",
    name: "Governo de Pernambuco",
    governments: ["Pernambuco"],
    queryFields: ["registration"],
    mockAgency: "GOVERNO DO ESTADO DE PERNAMBUCO",
    mockDelay: 0,
  },
  {
    id: "rondonia-primary",
    adapter: "rondonia",
    queryPortalId: "rondonia",
    name: "Governo de Rondônia",
    governments: ["Rondônia"],
    mockAgency: "GOVERNO DO ESTADO DE RONDÔNIA",
    mockDelay: 0,
  },
  {
    id: "maranhao-primary",
    adapter: "consigfacil",
    queryPortalId: "maranhao",
    name: "Governo do Maranhão",
    governments: ["Maranhão"],
    queryFields: ["registration"],
    mockAgency: "GOVERNO DO ESTADO DO MARANHÃO",
    mockDelay: 0,
  },
  {
    id: "roraima-primary",
    adapter: "roraima",
    queryPortalId: "roraima",
    name: "Governo de Roraima",
    governments: ["Roraima"],
    mockAgency: "GOVERNO DO ESTADO DE RORAIMA",
    mockDelay: 0,
  },
];

test("alterna consultas Gov SP entre os acessos conectados", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });

  assert.deepEqual(service.list().map((portal) => portal.id), [
    "gov-sp-primary",
    "gov-sp-secondary",
    "prefeitura-sao-paulo-primary",
    "piaui-primary",
    "pernambuco-primary",
    "rondonia-primary",
    "maranhao-primary",
    "roraima-primary",
  ]);

  const first = await service.query("portal-consignado", "52998224725", "admin");
  const second = await service.query("portal-consignado", "52998224725", "admin");
  const third = await service.query("portal-consignado", "52998224725", "admin");

  assert.equal(first.connectionId, "gov-sp-primary");
  assert.equal(second.connectionId, "gov-sp-secondary");
  assert.equal(third.connectionId, "gov-sp-primary");
  assert.deepEqual(service.history().map((item) => item.portal), [
    "Gov SP · Acesso 1",
    "Gov SP · Acesso 2",
    "Gov SP · Acesso 1",
  ]);

  await service.close();
});

test("mantém a Prefeitura fora do rodízio estadual", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });
  const result = await service.query("prefeitura-sao-paulo", "52998224725", "admin");
  assert.equal(result.portal, "prefeitura-sao-paulo");
  assert.equal(result.connectionId, "prefeitura-sao-paulo-primary");
  assert.equal(result.employments[0].agency, "PREFEITURA DE SÃO PAULO");
  await service.close();
});

test("consulta o Piauí com matrícula e cartões próprios no modo de demonstração", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });
  assert.deepEqual(service.requirements("piaui"), { fields: ["registration"] });
  const result = await service.query(
    "piaui",
    "52998224725",
    "admin",
    { registration: "2148609" },
  );
  assert.equal(result.connectionId, "piaui-primary");
  assert.equal(result.employments[0].registration, "2148609");
  assert.deepEqual(
    result.employments[0].margins.map(({ product }) => product),
    ["MARGEM CONSIGNÁVEL", "MARGEM CARTÃO"],
  );
  await service.close();
});

test("mantém Pernambuco em sessão própria com matrícula obrigatória", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });
  assert.deepEqual(service.requirements("pernambuco"), { fields: ["registration"] });
  const result = await service.query(
    "pernambuco",
    "52998224725",
    "admin",
    { registration: "9876543" },
  );
  assert.equal(result.connectionId, "pernambuco-primary");
  assert.equal(result.employments[0].agency, "GOVERNO DO ESTADO DE PERNAMBUCO");
  assert.equal(result.employments[0].registration, "9876543");
  await service.close();
});

test("consulta Rondônia somente com CPF e retorna os três tipos de margem", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });
  assert.deepEqual(service.requirements("rondonia"), { fields: [] });
  const result = await service.query("rondonia", "52998224725", "admin");
  assert.equal(result.connectionId, "rondonia-primary");
  assert.equal(result.view, "single");
  assert.equal(result.employments[0].agency, "GOVERNO DO ESTADO DE RONDÔNIA");
  assert.deepEqual(
    result.employments[0].margins.map(({ product }) => product),
    ["MARGEM DISPONÍVEL", "MARGEM CARTÃO", "MARGEM CARTÃO BENEFÍCIO"],
  );
  await service.close();
});

test("mantém Maranhão em sessão ConsigFácil própria com matrícula obrigatória", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });
  assert.deepEqual(service.requirements("maranhao"), { fields: ["registration"] });
  const result = await service.query(
    "maranhao",
    "52998224725",
    "admin",
    { registration: "1234567" },
  );
  assert.equal(result.connectionId, "maranhao-primary");
  assert.equal(result.employments[0].agency, "GOVERNO DO ESTADO DO MARANHÃO");
  assert.equal(result.employments[0].registration, "1234567");
  await service.close();
});

test("consulta Roraima por CPF com SIGRH padrão ou SGG selecionado", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });
  assert.deepEqual(service.requirements("roraima"), { fields: [] });

  const defaultResult = await service.query("roraima", "52998224725", "admin");
  assert.equal(defaultResult.connectionId, "roraima-primary");
  assert.match(defaultResult.employments[0].provision, /SIGRH/);
  assert.deepEqual(defaultResult.employments[0].margins, [
    { product: "MARGEM EMPRÉSTIMO", value: "0,00" },
  ]);

  const sggResult = await service.query(
    "roraima",
    "52998224725",
    "admin",
    { company: "sgg" },
  );
  assert.match(sggResult.employments[0].provision, /SGG/);
  await service.close();
});

test("mantém o CAPTCHA da consulta vinculado ao operador", async () => {
  const definition = portalDefinitions[3];
  const service = createPortalService(
    { portalMode: "real", portals: [definition] },
    {
      createPortal() {
        return {
          status: () => ({ state: "connected", mode: "real" }),
          async queryMargin() {
            return {
              requiresCaptcha: true,
              challengeType: "query_captcha",
              portal: "piaui",
              captchaImage: "data:image/png;base64,teste",
            };
          },
          async submitQueryCaptcha() {
            return { portal: "piaui", connectionId: "piaui-primary" };
          },
          cancelPendingQuery() {},
          async close() {},
        };
      },
    },
  );

  const challenge = await service.query(
    "piaui",
    "52998224725",
    "vendedor1",
    { registration: "2148609" },
  );
  assert.equal(challenge.requiresCaptcha, true);
  assert.ok(challenge.challengeId);
  assert.throws(
    () => service.submitQueryCaptcha(challenge.challengeId, "1234", "outro-vendedor"),
    (error) => error.code === "QUERY_CHALLENGE_INVALID",
  );
  const result = await service.submitQueryCaptcha(
    challenge.challengeId,
    "1234",
    "vendedor1",
  );
  assert.equal(result.connectionId, "piaui-primary");
  assert.deepEqual(service.history().map(({ status }) => status), ["success"]);
  await service.close();
});

test("rejeita identificadores de portal desconhecidos", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });
  assert.throws(
    () => service.query("portal-inexistente", "52998224725", "admin"),
    (error) => error.code === "INVALID_PORTAL" && error.status === 400,
  );
  await service.close();
});

test("tenta outro acesso quando a sessão selecionada foi invalidada", async () => {
  const attempts = [];
  const service = createPortalService(
    { portalMode: "real", portals: portalDefinitions.slice(0, 2) },
    {
      createPortal(definition) {
        let state = "connected";
        return {
          status: () => ({ state, mode: "real" }),
          async queryMargin(cpf) {
            attempts.push(definition.id);
            if (definition.id === "gov-sp-primary") {
              state = "disconnected";
              throw new PortalError(
                "PORTAL_SESSION_EXPIRED",
                "A sessão do portal expirou.",
                409,
              );
            }
            return { portal: definition.queryPortalId, connectionId: definition.id, cpf };
          },
          async close() {},
        };
      },
    },
  );

  const result = await service.query("portal-consignado", "52998224725", "admin");

  assert.equal(result.connectionId, "gov-sp-secondary");
  assert.deepEqual(attempts, ["gov-sp-primary", "gov-sp-secondary"]);
  assert.equal(service.list().find(({ id }) => id === "gov-sp-primary").state, "disconnected");
  assert.deepEqual(service.history().map(({ status }) => status), ["success"]);
  await service.close();
});
