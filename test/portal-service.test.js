import test from "node:test";
import assert from "node:assert/strict";
import { createPortalService } from "../src/portal-service.js";

const portalDefinitions = [
  {
    id: "portal-consignado",
    name: "Portal do Consignado",
    governments: ["São Paulo", "PMESP"],
    mockAgency: "PMESP",
    mockDelay: 0,
  },
  {
    id: "prefeitura-sao-paulo",
    name: "Prefeitura de São Paulo",
    governments: ["Prefeitura de São Paulo"],
    mockAgency: "PREFEITURA DE SÃO PAULO",
    mockDelay: 0,
  },
];

test("mantém duas integrações independentes e registra a origem da consulta", async () => {
  const service = createPortalService({ portalMode: "mock", portals: portalDefinitions });

  assert.deepEqual(service.list().map((portal) => portal.id), [
    "portal-consignado",
    "prefeitura-sao-paulo",
  ]);

  const result = await service.query("prefeitura-sao-paulo", "52998224725", "admin");
  assert.equal(result.portal, "prefeitura-sao-paulo");
  assert.equal(result.employments[0].agency, "PREFEITURA DE SÃO PAULO");
  assert.equal(service.history()[0].portal, "Prefeitura de São Paulo");

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
