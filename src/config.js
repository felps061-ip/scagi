import { randomBytes } from "node:crypto";

const isProduction = process.env.NODE_ENV === "production";
const portalMode = process.env.PORTAL_MODE === "real" ? "real" : "mock";

function readBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return value.toLowerCase() === "true";
}

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  isProduction,
  appUser: process.env.APP_USER || "admin",
  appPassword: process.env.APP_PASSWORD || (isProduction ? "" : "scagi-demo"),
  sessionSecret:
    process.env.SESSION_SECRET ||
    (isProduction ? "" : randomBytes(32).toString("hex")),
  portalMode,
  portals: [
    {
      id: "gov-sp-primary",
      queryPortalId: "portal-consignado",
      name: "Gov SP · Acesso 1",
      governments: ["São Paulo", "PMESP"],
      mockAgency: "PMESP",
      baseUrl: "https://www.portaldoconsignado.com.br",
      username: process.env.PORTAL_CONSIGNADO_USERNAME || "",
      password: process.env.PORTAL_CONSIGNADO_PASSWORD || "",
      usernameVariable: "PORTAL_CONSIGNADO_USERNAME",
      passwordVariable: "PORTAL_CONSIGNADO_PASSWORD",
      browserChannel: process.env.PORTAL_BROWSER_CHANNEL || "",
      headless: readBoolean(process.env.PLAYWRIGHT_HEADLESS, true),
    },
    {
      id: "gov-sp-secondary",
      queryPortalId: "portal-consignado",
      name: "Gov SP · Acesso 2",
      governments: ["São Paulo", "PMESP"],
      mockAgency: "PMESP",
      baseUrl: "https://www.portaldoconsignado.com.br",
      username: process.env.PORTAL_CONSIGNADO_GOV_SP_2_USERNAME || "",
      password: process.env.PORTAL_CONSIGNADO_GOV_SP_2_PASSWORD || "",
      usernameVariable: "PORTAL_CONSIGNADO_GOV_SP_2_USERNAME",
      passwordVariable: "PORTAL_CONSIGNADO_GOV_SP_2_PASSWORD",
      browserChannel: process.env.PORTAL_BROWSER_CHANNEL || "",
      headless: readBoolean(process.env.PLAYWRIGHT_HEADLESS, true),
    },
    {
      id: "prefeitura-sao-paulo-primary",
      queryPortalId: "prefeitura-sao-paulo",
      name: "Prefeitura de São Paulo",
      governments: ["Prefeitura de São Paulo"],
      mockAgency: "PREFEITURA DE SÃO PAULO",
      baseUrl: "https://www.portaldoconsignado.com.br",
      username: process.env.PORTAL_PREFEITURA_SP_USERNAME || "",
      password: process.env.PORTAL_PREFEITURA_SP_PASSWORD || "",
      usernameVariable: "PORTAL_PREFEITURA_SP_USERNAME",
      passwordVariable: "PORTAL_PREFEITURA_SP_PASSWORD",
      browserChannel: process.env.PORTAL_BROWSER_CHANNEL || "",
      headless: readBoolean(process.env.PLAYWRIGHT_HEADLESS, true),
    },
  ],
};

export function validateConfig() {
  const errors = [];

  if (!Number.isInteger(config.port) || config.port < 1 || config.port > 65535) {
    errors.push("PORT precisa ser uma porta TCP válida.");
  }

  if (!config.appPassword) {
    errors.push("APP_PASSWORD é obrigatório em produção.");
  }

  if (!config.sessionSecret || config.sessionSecret.length < 32) {
    errors.push("SESSION_SECRET precisa ter pelo menos 32 caracteres em produção.");
  }

  if (config.portalMode === "real") {
    for (const portal of config.portals) {
      if (!portal.username) errors.push(`${portal.usernameVariable} é obrigatório no modo real.`);
      if (!portal.password) errors.push(`${portal.passwordVariable} é obrigatório no modo real.`);
    }
  }

  if (errors.length) {
    throw new Error(errors.join("\n"));
  }
}
