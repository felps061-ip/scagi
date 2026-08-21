import { randomBytes } from "node:crypto";

const isProduction = process.env.NODE_ENV === "production";
const portalMode = process.env.PORTAL_MODE === "real" ? "real" : "mock";

function readBoolean(value, fallback) {
  if (value == null || value === "") return fallback;
  return value.toLowerCase() === "true";
}

export function parseAppUsers(raw, fallbackUser, fallbackPassword) {
  if (!raw) {
    return [{ username: fallbackUser, password: fallbackPassword, role: "admin" }];
  }

  const users = JSON.parse(raw);
  if (!Array.isArray(users)) throw new Error("APP_USERS_JSON precisa ser uma lista JSON.");
  return users.map((user) => ({
    username: String(user?.username || "").trim(),
    password: String(user?.password || ""),
    role: user?.role === "admin" ? "admin" : "operator",
  }));
}

const fallbackAppUser = process.env.APP_USER || "admin";
const fallbackAppPassword = process.env.APP_PASSWORD || (isProduction ? "" : "scagi-demo");

export const config = {
  host: process.env.HOST || "127.0.0.1",
  port: Number(process.env.PORT || 3000),
  isProduction,
  users: parseAppUsers(process.env.APP_USERS_JSON, fallbackAppUser, fallbackAppPassword),
  sessionSecret:
    process.env.SESSION_SECRET ||
    (isProduction ? "" : randomBytes(32).toString("hex")),
  portalMode,
  portals: [
    {
      id: "gov-sp-primary",
      adapter: "portal-do-consignado",
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
      adapter: "portal-do-consignado",
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
      adapter: "portal-do-consignado",
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
    {
      id: "piaui-primary",
      adapter: "consigfacil",
      queryPortalId: "piaui",
      name: "Governo do Piauí",
      governments: ["Piauí"],
      queryFields: ["registration"],
      mockAgency: "GOVERNO DO ESTADO DO PIAUÍ",
      baseUrl: "https://consigfacil.sead.pi.gov.br",
      username: process.env.PORTAL_PIAUI_USERNAME || "",
      password: process.env.PORTAL_PIAUI_PASSWORD || "",
      usernameVariable: "PORTAL_PIAUI_USERNAME",
      passwordVariable: "PORTAL_PIAUI_PASSWORD",
      browserChannel: process.env.PORTAL_BROWSER_CHANNEL || "",
      headless: readBoolean(process.env.PLAYWRIGHT_HEADLESS, true),
    },
    {
      id: "pernambuco-primary",
      adapter: "consigfacil",
      queryPortalId: "pernambuco",
      name: "Governo de Pernambuco",
      governments: ["Pernambuco"],
      queryFields: ["registration"],
      mockAgency: "GOVERNO DO ESTADO DE PERNAMBUCO",
      baseUrl: "https://peconsig.pe.gov.br",
      username: process.env.PORTAL_PERNAMBUCO_USERNAME || "",
      password: process.env.PORTAL_PERNAMBUCO_PASSWORD || "",
      usernameVariable: "PORTAL_PERNAMBUCO_USERNAME",
      passwordVariable: "PORTAL_PERNAMBUCO_PASSWORD",
      browserChannel: process.env.PORTAL_BROWSER_CHANNEL || "",
      headless: readBoolean(process.env.PLAYWRIGHT_HEADLESS, true),
    },
    {
      id: "rondonia-primary",
      adapter: "rondonia",
      queryPortalId: "rondonia",
      name: "Governo de Rondônia",
      governments: ["Rondônia"],
      mockAgency: "GOVERNO DO ESTADO DE RONDÔNIA",
      baseUrl: "https://consignacao.sistemas.ro.gov.br/",
      username: process.env.PORTAL_RONDONIA_USERNAME || "",
      password: process.env.PORTAL_RONDONIA_PASSWORD || "",
      usernameVariable: "PORTAL_RONDONIA_USERNAME",
      passwordVariable: "PORTAL_RONDONIA_PASSWORD",
      browserChannel: process.env.PORTAL_BROWSER_CHANNEL || "",
      headless: readBoolean(process.env.PLAYWRIGHT_HEADLESS, true),
    },
    {
      id: "maranhao-primary",
      adapter: "consigfacil",
      queryPortalId: "maranhao",
      name: "Governo do Maranhão",
      governments: ["Maranhão"],
      queryFields: ["registration"],
      mockAgency: "GOVERNO DO ESTADO DO MARANHÃO",
      baseUrl: "https://www.faciltecnologia.com.br/consigfacil/maranhao",
      username: process.env.PORTAL_MARANHAO_USERNAME || "",
      password: process.env.PORTAL_MARANHAO_PASSWORD || "",
      usernameVariable: "PORTAL_MARANHAO_USERNAME",
      passwordVariable: "PORTAL_MARANHAO_PASSWORD",
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

  if (!config.users.length) {
    errors.push("Configure pelo menos um usuário do SCAGI.");
  }

  if (!config.users.some(({ role }) => role === "admin")) {
    errors.push("Configure pelo menos um usuário administrador do SCAGI.");
  }

  const usernames = new Set();
  for (const user of config.users) {
    if (!user.username) errors.push("Todo usuário do SCAGI precisa de um nome.");
    if (!user.password) errors.push(`A senha de ${user.username || "um usuário"} é obrigatória.`);
    if (usernames.has(user.username)) errors.push(`O usuário ${user.username} está duplicado.`);
    usernames.add(user.username);
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
