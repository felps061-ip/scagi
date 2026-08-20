import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config, validateConfig } from "./config.js";
import { isValidCpf, normalizeCpf } from "./cpf.js";
import { createPortalService } from "./portal-service.js";
import { PortalError } from "./portals/errors.js";
import {
  createSessionStore,
  expiredSessionCookie,
  parseCookies,
  sessionCookie,
} from "./security.js";
import { createUserStore } from "./user-store.js";

validateConfig();

const rootDir = dirname(dirname(fileURLToPath(import.meta.url)));
const publicDir = join(rootDir, "public");
const configuredUserStorePath = process.env.USER_STORE_PATH || join(".data", "users.json");
const userStore = createUserStore({
  filePath: isAbsolute(configuredUserStorePath)
    ? configuredUserStorePath
    : join(rootDir, configuredUserStorePath),
  seedUsers: config.users,
});
const sessions = createSessionStore(config.sessionSecret);
const portals = createPortalService(config);

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
};

function securityHeaders() {
  return {
    "Content-Security-Policy":
      "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'; form-action 'self'",
    "Referrer-Policy": "no-referrer",
    "X-Content-Type-Options": "nosniff",
    "X-Frame-Options": "DENY",
    "Permissions-Policy": "camera=(), microphone=(), geolocation=()",
    "Cache-Control": "no-store",
  };
}

function json(response, status, payload, headers = {}) {
  response.writeHead(status, {
    ...securityHeaders(),
    "Content-Type": "application/json; charset=utf-8",
    ...headers,
  });
  response.end(JSON.stringify(payload));
}

async function readJson(request) {
  let body = "";
  for await (const chunk of request) {
    body += chunk;
    if (body.length > 32_000) {
      const error = new Error("Corpo da requisição muito grande.");
      error.status = 413;
      throw error;
    }
  }
  if (!body) return {};
  try {
    return JSON.parse(body);
  } catch {
    const error = new Error("JSON inválido.");
    error.status = 400;
    throw error;
  }
}

function authSession(request) {
  const cookies = parseCookies(request.headers.cookie);
  return { token: cookies.scagi_session, session: sessions.read(cookies.scagi_session) };
}

function requireAuth(request, response) {
  const authentication = authSession(request);
  if (!authentication.session) {
    json(response, 401, { error: { code: "UNAUTHENTICATED", message: "Faça login no SCAGI." } });
    return null;
  }
  return authentication;
}

async function serveStatic(pathname, response) {
  const requestedPath = pathname === "/" ? "/index.html" : pathname;
  const safePath = normalize(requestedPath).replace(/^(\.\.(\/|\\|$))+/, "");
  const filePath = join(publicDir, safePath);

  if (!filePath.startsWith(publicDir)) return false;

  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
    response.writeHead(200, {
      ...securityHeaders(),
      "Content-Type": contentTypes[extname(filePath)] || "application/octet-stream",
      "Cache-Control": extname(filePath) === ".html" ? "no-store" : "public, max-age=300",
    });
    createReadStream(filePath).pipe(response);
    return true;
  } catch {
    return false;
  }
}

const server = createServer(async (request, response) => {
  const url = new URL(request.url, `http://${request.headers.host || "localhost"}`);

  try {
    if (request.method === "GET" && url.pathname === "/api/session") {
      const { session } = authSession(request);
      return json(response, 200, {
        authenticated: Boolean(session),
        user: session ? { username: session.username, role: session.role } : null,
        portalMode: config.portalMode,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const body = await readJson(request);
      const user = userStore.authenticate(body.username, body.password);
      if (!user) {
        return json(response, 401, {
          error: { code: "INVALID_CREDENTIALS", message: "Usuário ou senha inválidos." },
        });
      }
      const token = sessions.create(user);
      return json(
        response,
        200,
        { authenticated: true, user: { username: user.username, role: user.role } },
        { "Set-Cookie": sessionCookie(token, config.isProduction) },
      );
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const { token } = authSession(request);
      sessions.destroy(token);
      return json(response, 200, { authenticated: false }, {
        "Set-Cookie": expiredSessionCookie(config.isProduction),
      });
    }

    if (url.pathname.startsWith("/api/")) {
      const authentication = requireAuth(request, response);
      if (!authentication) return;

      if (request.method === "GET" && url.pathname === "/api/portals") {
        return json(response, 200, { portals: portals.list() });
      }

      if (request.method === "GET" && url.pathname === "/api/history") {
        return json(response, 200, { history: portals.history() });
      }

      if (url.pathname === "/api/users" || url.pathname.startsWith("/api/users/")) {
        if (authentication.session.role !== "admin") {
          return json(response, 403, {
            error: { code: "FORBIDDEN", message: "Somente administradores podem gerenciar usuários." },
          });
        }

        if (request.method === "GET" && url.pathname === "/api/users") {
          return json(response, 200, { users: userStore.list() });
        }

        if (request.method === "POST" && url.pathname === "/api/users") {
          const body = await readJson(request);
          return json(response, 201, { user: userStore.createSeller(body.username, body.password) });
        }

        const userAction = url.pathname.match(/^\/api\/users\/([a-z0-9._-]+)(?:\/(password))?$/);
        if (userAction && request.method === "PATCH" && userAction[2] === "password") {
          const body = await readJson(request);
          const user = userStore.resetPassword(userAction[1], body.password);
          sessions.destroyByUsername(user.username);
          return json(response, 200, { user });
        }
        if (userAction && request.method === "DELETE" && !userAction[2]) {
          if (userAction[1] === authentication.session.username) {
            return json(response, 409, {
              error: { code: "CANNOT_DELETE_SELF", message: "Você não pode remover o próprio usuário." },
            });
          }
          userStore.remove(userAction[1]);
          sessions.destroyByUsername(userAction[1]);
          return json(response, 200, { removed: true });
        }
      }

      const portalAction = url.pathname.match(
        /^\/api\/portals\/([a-z0-9-]+)\/(connect|captcha)$/,
      );
      if (request.method === "POST" && portalAction) {
        const [, portalId, action] = portalAction;
        if (action === "connect") {
          return json(response, 200, await portals.prepareLogin(portalId));
        }
        const body = await readJson(request);
        return json(response, 200, await portals.submitCaptcha(portalId, body.captcha));
      }

      if (request.method === "POST" && url.pathname === "/api/margins/query") {
        const body = await readJson(request);
        if (!portals.has(body.portal)) {
          return json(response, 400, {
            error: { code: "INVALID_PORTAL", message: "Selecione uma averbadora válida." },
          });
        }
        const cpf = normalizeCpf(body.cpf);
        if (!isValidCpf(cpf)) {
          return json(response, 400, {
            error: { code: "INVALID_CPF", message: "Informe um CPF válido." },
          });
        }
        return json(
          response,
          200,
          await portals.query(body.portal, cpf, authentication.session.username),
        );
      }

      return json(response, 404, {
        error: { code: "NOT_FOUND", message: "Rota de API não encontrada." },
      });
    }

    if (request.method === "GET" && (await serveStatic(url.pathname, response))) return;
    json(response, 404, { error: { code: "NOT_FOUND", message: "Página não encontrada." } });
  } catch (error) {
    const status = error instanceof PortalError ? error.status : error.status || 500;
    const code = error instanceof PortalError ? error.code : "INTERNAL_ERROR";
    const message = status >= 500 && !(error instanceof PortalError)
      ? "Ocorreu um erro interno no SCAGI."
      : error.message;
    if (status >= 500) console.error(error);
    json(response, status, {
      error: { code, message, ...(error.details ? { details: error.details } : {}) },
    });
  }
});

server.listen(config.port, config.host, () => {
  console.log(`SCAGI disponível em http://${config.host}:${config.port}`);
  console.log(`Modo do Portal do Consignado: ${config.portalMode}`);
  if (!config.isProduction && !process.env.APP_PASSWORD && !process.env.APP_USERS_JSON) {
    console.log("Acesso de desenvolvimento: admin / scagi-demo");
  }
});

async function shutdown() {
  await portals.close();
  server.close(() => process.exit(0));
}

process.once("SIGINT", shutdown);
process.once("SIGTERM", shutdown);
