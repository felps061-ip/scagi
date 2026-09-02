import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";
import { createServer } from "node:http";
import { dirname, extname, isAbsolute, join, normalize } from "node:path";
import { fileURLToPath } from "node:url";
import { config, validateConfig } from "./config.js";
import { createAuditLog } from "./audit-log.js";
import { createHistoryStore } from "./history-store.js";
import { isValidCpf, normalizeCpf } from "./cpf.js";
import { createPortalService } from "./portal-service.js";
import { PortalError } from "./portals/errors.js";
import { normalizeRegistration } from "./registration.js";
import {
  createSessionStore,
  createLoginRateLimiter,
  expiredSessionCookie,
  parseCookies,
  sessionCookie,
} from "./security.js";
import { createUserStore } from "./user-store.js";
import {
  canCreateUser,
  canManageUsers,
  canRemoveUser,
  canResetUserPassword,
  visibleUsersForRole,
} from "./user-permissions.js";

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
const portals = createPortalService(config, {
  historyStore: createHistoryStore({
    filePath: join(rootDir, ".data", "query-history.json"),
    secret: config.sessionSecret,
  }),
});
const loginRateLimiter = createLoginRateLimiter();
const audit = createAuditLog(join(rootDir, ".data", "audit.ndjson"));

const contentTypes = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".png": "image/png",
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

function clientAddress(request) {
  const cloudflareAddress = request.headers["cf-connecting-ip"];
  return String(Array.isArray(cloudflareAddress) ? cloudflareAddress[0] : cloudflareAddress || request.socket.remoteAddress || "unknown").slice(0, 128);
}

function originAllowed(request) {
  const origin = request.headers.origin;
  if (!origin) return false;
  try {
    return new URL(origin).host === String(request.headers.host || "").toLowerCase();
  } catch {
    return false;
  }
}

function requireSameOrigin(request, response) {
  if (originAllowed(request)) return true;
  json(response, 403, { error: { code: "INVALID_ORIGIN", message: "Esta ação deve ser iniciada pelo site do SCAGI." } });
  return false;
}

function safeErrorDetails(error) {
  const captchaImage = error?.details?.captchaImage;
  if (typeof captchaImage === "string" && captchaImage.startsWith("data:image/") && captchaImage.length <= 1_500_000) {
    return { captchaImage };
  }
  return undefined;
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
    if (["POST", "PATCH", "DELETE"].includes(request.method) && !requireSameOrigin(request, response)) return;

    if (request.method === "GET" && url.pathname === "/api/session") {
      const { session } = authSession(request);
      return json(response, 200, {
        authenticated: Boolean(session),
        user: session ? { username: session.username, role: session.role } : null,
        portalMode: config.portalMode,
      });
    }

    if (request.method === "POST" && url.pathname === "/api/auth/login") {
      const address = clientAddress(request);
      const limit = loginRateLimiter.check(address);
      if (!limit.allowed) {
        audit.write("login_rate_limited", { address });
        return json(response, 429, {
          error: { code: "LOGIN_RATE_LIMITED", message: "Muitas tentativas de login. Aguarde alguns minutos e tente novamente." },
        }, { "Retry-After": String(limit.retryAfterSeconds) });
      }
      const body = await readJson(request);
      const user = userStore.authenticate(body.username, body.password);
      if (!user) {
        loginRateLimiter.recordFailure(address);
        audit.write("login_failed", { address });
        return json(response, 401, {
          error: { code: "INVALID_CREDENTIALS", message: "Usuário ou senha inválidos." },
        });
      }
      loginRateLimiter.reset(address);
      audit.write("login_succeeded", { address, actor: user.username });
      const token = sessions.create(user);
      return json(
        response,
        200,
        { authenticated: true, user: { username: user.username, role: user.role } },
        { "Set-Cookie": sessionCookie(token, config.cookieSecure) },
      );
    }

    if (request.method === "POST" && url.pathname === "/api/auth/logout") {
      const { token } = authSession(request);
      sessions.destroy(token);
      audit.write("logout", { address: clientAddress(request) });
      return json(response, 200, { authenticated: false }, {
        "Set-Cookie": expiredSessionCookie(config.cookieSecure),
      });
    }

    if (url.pathname.startsWith("/api/")) {
      const authentication = requireAuth(request, response);
      if (!authentication) return;

      if (request.method === "GET" && url.pathname === "/api/portals") {
        return json(response, 200, { portals: portals.list() });
      }

      if (request.method === "GET" && url.pathname === "/api/history") {
        const history = portals.history(url.searchParams.get("cpf"));
        return json(response, 200, {
          history: authentication.session.role === "admin"
            ? history
            : history.filter(({ actor }) => actor === authentication.session.username),
        });
      }

      if (url.pathname === "/api/users" || url.pathname.startsWith("/api/users/")) {
        const actorRole = authentication.session.role;
        if (!canManageUsers(actorRole)) {
          return json(response, 403, {
            error: { code: "FORBIDDEN", message: "Seu perfil não pode gerenciar vendedores." },
          });
        }

        if (request.method === "GET" && url.pathname === "/api/users") {
          return json(response, 200, {
            users: visibleUsersForRole(userStore.list(), actorRole),
          });
        }

        if (request.method === "POST" && url.pathname === "/api/users") {
          const body = await readJson(request);
          const requestedRole = String(body.role || "operator").trim().toLowerCase();
          if (!canCreateUser(actorRole, requestedRole)) {
            return json(response, 403, {
              error: {
                code: "FORBIDDEN",
                message: "Seu perfil não pode criar esse tipo de usuário.",
              },
            });
          }
          const user = userStore.createUser(body.username, body.password, requestedRole);
          audit.write("user_created", { actor: authentication.session.username, target: user.username, role: user.role });
          return json(response, 201, { user });
        }

        const userAction = url.pathname.match(/^\/api\/users\/([a-z0-9._-]+)(?:\/(password))?$/);
        if (userAction && request.method === "PATCH" && userAction[2] === "password") {
          const target = userStore.get(userAction[1]);
          if (!target) {
            throw new PortalError("USER_NOT_FOUND", "Usuário não encontrado.", 404);
          }
          if (!canResetUserPassword(actorRole, target.role)) {
            return json(response, 403, {
              error: {
                code: "FORBIDDEN",
                message: "Supervisores só podem redefinir senhas de vendedores.",
              },
            });
          }
          const body = await readJson(request);
          const user = userStore.resetPassword(userAction[1], body.password);
          sessions.destroyByUsername(user.username);
          audit.write("password_reset", { actor: authentication.session.username, target: user.username });
          return json(response, 200, { user });
        }
        if (userAction && request.method === "DELETE" && !userAction[2]) {
          if (!canRemoveUser(actorRole)) {
            return json(response, 403, {
              error: { code: "FORBIDDEN", message: "Supervisores não podem remover usuários." },
            });
          }
          if (userAction[1] === authentication.session.username) {
            return json(response, 409, {
              error: { code: "CANNOT_DELETE_SELF", message: "Você não pode remover o próprio usuário." },
            });
          }
          userStore.remove(userAction[1]);
          sessions.destroyByUsername(userAction[1]);
          audit.write("user_removed", { actor: authentication.session.username, target: userAction[1] });
          return json(response, 200, { removed: true });
        }
      }

      const portalAction = url.pathname.match(
        /^\/api\/portals\/([a-z0-9-]+)\/(connect|captcha)$/,
      );
      if (request.method === "POST" && portalAction) {
        const [, portalId, action] = portalAction;
        if (action === "connect") {
          if (!["admin", "supervisor"].includes(authentication.session.role)) {
            return json(response, 403, { error: { code: "FORBIDDEN", message: "Somente administradores e supervisores podem conectar acessos compartilhados." } });
          }
          audit.write("portal_connection_requested", { actor: authentication.session.username, portal: portalId });
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
        const requirements = portals.requirements(body.portal);
        const registration = normalizeRegistration(body.registration);
        const company = ["sgg", "sigrh"].includes(body.company) ? body.company : "sigrh";
        if (requirements.fields.includes("registration") && !registration) {
          return json(response, 400, {
            error: { code: "REGISTRATION_REQUIRED", message: "Informe a matrícula do servidor." },
          });
        }
        return json(
          response,
          200,
          await portals.query(
            body.portal,
            cpf,
            authentication.session.username,
            { registration, company },
          ),
        );
      }

      if (request.method === "POST" && url.pathname === "/api/margins/query/captcha") {
        const body = await readJson(request);
        return json(
          response,
          200,
          await portals.submitQueryCaptcha(
            body.challengeId,
            body.captcha,
            authentication.session.username,
          ),
        );
      }

      if (request.method === "POST" && url.pathname === "/api/margins/query/cancel") {
        const body = await readJson(request);
        return json(
          response,
          200,
          portals.cancelQueryCaptcha(body.challengeId, authentication.session.username),
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
      ? "Não foi possível concluir a operação porque ocorreu uma falha inesperada no servidor. Tente novamente; se o problema persistir, informe o horário do erro ao suporte."
      : error.message;
    if (status >= 500) console.error(error);
    const details = safeErrorDetails(error);
    json(response, status, { error: { code, message, ...(details ? { details } : {}) } });
  }
});

server.headersTimeout = 15_000;
server.requestTimeout = 30_000;
server.keepAliveTimeout = 5_000;

server.listen(config.port, config.host, () => {
  console.log(`SCAGI disponível em http://${config.host}:${config.port}`);
  console.log(`Modo das integrações: ${config.portalMode}`);
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
