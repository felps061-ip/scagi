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
    const isRondonia = this.options.adapter === "rondonia";
    const isRoraima = this.options.adapter === "roraima";
    return {
      portal: this.options.queryPortalId,
      connectionId: this.options.id,
      cpf: formatCpf(cpf),
      queriedAt: new Date().toISOString(),
      source: "mock",
      ...(isRondonia ? { view: "single" } : {}),
      employments: [
        {
          name: "CLIENTE DE DEMONSTRAÇÃO",
          agency: this.options.mockAgency,
          registration: isConsigfacil
            ? parameters.registration || "2148609"
            : isRondonia
              ? "300000000-0"
              : "000000",
          referenceMonth: new Intl.DateTimeFormat("pt-BR", {
            month: "2-digit",
            year: "numeric",
          }).format(new Date()),
          nextPayrollProcessing: "Não informado",
          provision: isRoraima
            ? `0810 - EMP. B. DAYCOVAL · ${(parameters.company || "sigrh").toUpperCase()}`
            : isConsigfacil || isRondonia
              ? "Margens disponíveis"
              : "Provimento 1",
          ...(isRondonia
            ? {
                details: {
                  cargo: "CARGO DE DEMONSTRAÇÃO",
                  lotacao: "ÓRGÃO DE DEMONSTRAÇÃO",
                  classificacao: "SERVIDOR",
                },
              }
            : {}),
          margins: isRoraima
            ? [{ product: "MARGEM EMPRÉSTIMO", value: "0,00" }]
            : isRondonia
            ? [
                { product: "MARGEM DISPONÍVEL", value: "Sem Margem" },
                { product: "MARGEM CARTÃO", value: "Sem Margem" },
                { product: "MARGEM CARTÃO BENEFÍCIO", value: "Sem Margem" },
              ]
            : isConsigfacil
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
