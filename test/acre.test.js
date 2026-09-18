import test from "node:test";
import assert from "node:assert/strict";
import { readAcreResult, validateAcreResult } from "../src/portals/acre.js";
import { config } from "../src/config.js";
import { createPortalService } from "../src/portal-service.js";

const result = { name: "SERVIDOR FICTÍCIO", registration: "00123456", serverType: "CARREIRA", cpf: "52998224725", birthDate: "01/01/1980", margin: "2,20" };
test("Acre: lê valores dos inputs readonly, incluindo CPF específico do resultado", async () => {
  const inputs = {
    "#body_clienteTextBox[readonly]": " SERVIDOR FICTÍCIO ",
    "#body_matriculaTextBox[readonly]": "00123456",
    "#body_categoriaTextBox[readonly]": "CARREIRA",
    "#body_cpf_nascimentoTextBox[readonly]": "52998224725",
    "#body_dataNascimentoTextBox[readonly]": "01/01/1980",
    "#body_margemTextBox[readonly]": "2,20",
  };
  const page = { locator(selector) {
    assert.ok(Object.hasOwn(inputs, selector), `Seletor inesperado: ${selector}`);
    return { waitFor: async () => {}, inputValue: async () => inputs[selector] };
  } };
  const data = validateAcreResult(await readAcreResult(page), "52998224725", "00123456");
  assert.deepEqual(data, result);
  assert.equal(data.name, "SERVIDOR FICTÍCIO");
  assert.equal(data.serverType, "CARREIRA");
  assert.equal(data.birthDate, "01/01/1980");
  assert.equal(data.margin, "2,20");
});
test("Acre: rejeita resultado incompleto ou de outro servidor", () => {
  const data = result;
  assert.throws(() => validateAcreResult({ ...data, margin: "" }, "52998224725", "00123456"), { code: "PORTAL_RESULT_INVALID" });
  assert.throws(() => validateAcreResult(data, "00000000000", "00123456"), { code: "PORTAL_RESULT_MISMATCH" });
  assert.throws(() => validateAcreResult(data, "52998224725", "9999"), { code: "PORTAL_RESULT_MISMATCH" });
});
test("Acre: disponibiliza matrícula obrigatória e demonstração no serviço", async () => {
  const portal = config.portals.find((p) => p.adapter === "acre");
  const service = createPortalService({ portalMode: "mock", portals: [{ ...portal, mockDelay: 0 }] });
  assert.deepEqual(service.requirements("acre"), { fields: ["registration"] });
  const result = await service.query("acre", "52998224725", "teste", { registration: "00123456" });
  assert.equal(result.employments[0].registration, "00123456");
  assert.equal(result.employments[0].details.serverType, "CARREIRA");
  assert.equal(result.source, "mock");
  await service.close();
});
