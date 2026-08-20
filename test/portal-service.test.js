import test from "node:test";
import assert from "node:assert/strict";
import { createPortalService } from "../src/portal-service.js";

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
];

test("alterna consultas Gov SP entre os acessos conectados", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });

  assert.deepEqual(service.list().map((portal) => portal.id), [
    "gov-sp-primary",
    "gov-sp-secondary",
    "prefeitura-sao-paulo-primary",
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

test("rejeita identificadores de portal desconhecidos", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });
  assert.throws(
    () => service.query("portal-inexistente", "52998224725", "admin"),
    (error) => error.code === "INVALID_PORTAL" && error.status === 400,
  );
  await service.close();
});
