import { formatCpf } from "../cpf.js";

export class MockPortalDoConsignado {
  constructor(options) {
    this.options = options;
    this.state = "connected";
    this.updatedAt = new Date().toISOString();
  }

  status() {
    return {
      state: this.state,
      mode: "mock",
      updatedAt: this.updatedAt,
      message: "Ambiente de demonstração pronto para consultas.",
    };
  }

  async prepareLogin() {
    this.updatedAt = new Date().toISOString();
    return this.status();
  }

  async submitCaptcha() {
    return this.status();
  }

  async queryMargin(cpf, parameters = {}) {
    await new Promise((resolve) => setTimeout(resolve, this.options.mockDelay ?? 650));
    const isConsigfacil = this.options.adapter === "consigfacil";
    return {
      portal: this.options.queryPortalId,
      connectionId: this.options.id,
      cpf: formatCpf(cpf),
      queriedAt: new Date().toISOString(),
      source: "mock",
      employments: [
        {
          name: "CLIENTE DE DEMONSTRAÇÃO",
          agency: this.options.mockAgency,
          registration: isConsigfacil ? parameters.registration || "2148609" : "000000",
          referenceMonth: new Intl.DateTimeFormat("pt-BR", {
            month: "2-digit",
            year: "numeric",
          }).format(new Date()),
          nextPayrollProcessing: "Não informado",
          provision: isConsigfacil ? "Margens disponíveis" : "Provimento 1",
          margins: isConsigfacil
            ? [
                { product: "MARGEM CONSIGNÁVEL", value: "226,87" },
                { product: "MARGEM CARTÃO", value: "194,40" },
              ]
            : [
                { product: "CONSIGNAÇÕES FACULTATIVAS", value: "0,00" },
                { product: "CARTÃO DE CRÉDITO", value: "251,36" },
                { product: "CARTÃO DE BENEFÍCIO", value: "265,35" },
              ],
        },
      ],
    };
  }

  async close() {}
}
