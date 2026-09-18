import { formatCpf } from "../cpf.js";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import { normalizeRegistration } from "../registration.js";
import { PortalError } from "./errors.js";
import { assertTrustedPortalPage } from "./trusted-origin.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
const amountPattern = /-?\s*(?:R\$\s*)?\d{1,3}(?:\.\d{3})*,\d{2}/g;

async function writeDiagnostic(stage, error, page, feedback = "") {
  // Log operacional sem CPF, credenciais, CAPTCHA ou parâmetros da URL.
  const filePath = process.env.PORTAL_DIAGNOSTICS_PATH || join(process.cwd(), ".data", "portal-diagnostics.log");
  const url = page?.url?.() || "";
  const entry = {
    at: new Date().toISOString(), portal: "mato-grosso-sul", stage,
    code: error?.code || "UNEXPECTED_ERROR", message: clean(error?.message),
    feedback: clean(feedback), url: url.replace(/[?#].*$/, ""),
  };
  await mkdir(dirname(filePath), { recursive: true });
  await appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
}

function normalizeAmount(value) {
  const text = clean(value).replace(/\s/g, "");
  const negative = text.startsWith("-");
  const numeric = text.replace(/[^\d,]/g, "").replace(/\./g, "").replace(",", ".");
  const amount = Number(numeric);
  return Number.isFinite(amount) ? (negative ? -Math.abs(amount) : amount) : null;
}

function productFor(text, index) {
  if (/benef[ií]cio/i.test(text)) return "MARGEM CARTÃO BENEFÍCIO";
  if (/cart[aã]o/i.test(text)) return "MARGEM CARTÃO";
  return index === 0 ? "MARGEM DISPONÍVEL" : `MARGEM ${index + 1}`;
}

export function readMatoGrossoDoSulRows(rows, cpf, requestedRegistration = "") {
  const registrationFilter = normalizeRegistration(requestedRegistration);
  return rows.flatMap((cells) => {
    const values = cells.map(clean).filter(Boolean);
    const text = values.join(" · ");
    const returnedCpf = (text.match(/\d{3}\.?\d{3}\.?\d{3}-?\d{2}/)?.[0] || "").replace(/\D/g, "");
    if (returnedCpf && returnedCpf !== String(cpf).replace(/\D/g, "")) return [];
    const registration = values.find((value) => /\d{4,}[\d-]*/.test(value)) || "Não informado";
    const normalizedRegistration = normalizeRegistration(registration);
    if (registrationFilter && normalizedRegistration !== registrationFilter) return [];
    const amounts = [...text.matchAll(amountPattern)]
      .map((match) => ({ raw: match[0], value: normalizeAmount(match[0]), index: match.index || 0 }))
      .filter(({ value }) => value !== null && value > 0);
    if (!amounts.length) return [];
    return [{
      name: values.find((value) => /[A-Za-zÀ-ÿ]{3,}/.test(value) && !/margem|matr[ií]cula|cpf/i.test(value)) || "Servidor consultado",
      registration,
      agency: "GOVERNO DO ESTADO DE MATO GROSSO DO SUL",
      referenceMonth: "Não informado",
      nextPayrollProcessing: "Não informado",
      provision: "Margens disponíveis",
      cpf: formatCpf(cpf),
      margins: amounts.map(({ raw, index }) => ({ product: productFor(text.slice(0, index), index), value: clean(raw).replace(/^\s+/, "") })),
    }];
  });
}

export function readMatoGrossoDoSulDetails(entries, cpf, requestedRegistration = "") {
  const fields = new Map();
  for (let index = 0; index < entries.length - 1; index += 1) {
    if (entries[index].type !== "dt" || entries[index + 1].type !== "dd") continue;
    fields.set(clean(entries[index].text).replace(/:$/, "").toLowerCase(), clean(entries[index + 1].text));
  }
  const returnedCpf = (fields.get("cpf") || "").replace(/\D/g, "");
  if (returnedCpf !== String(cpf).replace(/\D/g, "")) return [];
  const server = fields.get("servidor") || "";
  const registration = server.match(/^\s*([\d-]+)/)?.[1] || "Não informado";
  if (requestedRegistration && normalizeRegistration(registration) !== normalizeRegistration(requestedRegistration)) return [];
  const margin = fields.get("margem disponível") || "";
  if (normalizeAmount(margin) === null) return [];
  const name = clean(server.replace(/^\s*[\d-]+\s*-?\s*/, "")) || "Servidor consultado";
  const agency = fields.get("órgão") || "GOVERNO DO ESTADO DE MATO GROSSO DO SUL";
  const category = fields.get("categoria") || "Não informado";
  return [{
    name, registration, agency, cpf: formatCpf(cpf), provision: "Margem consignável",
    referenceMonth: "Não informado", nextPayrollProcessing: "Não informado",
    details: { orgao: agency, categoria: category },
    margins: [{ product: "MARGEM DISPONÍVEL", value: margin }],
  }];
}

export class MatoGrossoDoSulPortal {
  constructor(options) {
    this.options = options;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.pendingQuery = null;
    this.state = "disconnected";
    this.updatedAt = new Date().toISOString();
    this.message = "Conexão com o portal ainda não iniciada.";
    if (!options.username || !options.password) this.setStatus("not_configured", "Configure o usuário e a senha do Mato Grosso do Sul.");
  }

  status(extra = {}) { return { state: this.state, mode: "real", updatedAt: this.updatedAt, message: this.message, ...extra }; }
  setStatus(state, message) { this.state = state; this.message = message; this.updatedAt = new Date().toISOString(); }

  async ensurePage() {
    if (this.page && !this.page.isClosed()) return this.page;
    let playwright;
    try { playwright = await import("playwright"); } catch { throw new PortalError("PLAYWRIGHT_NOT_INSTALLED", "O Playwright não está instalado.", 503); }
    const launchOptions = { headless: this.options.headless };
    if (this.options.browserChannel) launchOptions.channel = this.options.browserChannel;
    this.browser = await playwright.chromium.launch(launchOptions);
    this.context = await this.browser.newContext({ locale: "pt-BR", viewport: { width: 1440, height: 1000 } });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(30_000);
    return this.page;
  }

  async feedback() {
    return (await this.page.locator('[role="alert"]:visible, .alert-danger:visible, .alert-warning:visible').allTextContents()).map(clean).filter(Boolean).join(" ");
  }

  async captchaImage() {
    const image = this.page.locator('img[alt="Código"], img[src*="codigo" i], img[src*="captcha" i]').first();
    await image.waitFor({ state: "visible" });
    return `data:image/png;base64,${(await image.screenshot({ type: "png" })).toString("base64")}`;
  }

  async prepareLogin() {
    if (!this.options.username || !this.options.password) throw new PortalError("PORTAL_NOT_CONFIGURED", "O acesso ao Mato Grosso do Sul ainda não possui usuário e senha configurados.", 422);
    const page = await this.ensurePage();
    this.setStatus("connecting", "Abrindo o eConsig do Mato Grosso do Sul.");
    await page.goto(`${this.options.baseUrl}/v3/autenticarUsuario#no-back`, { waitUntil: "domcontentloaded", timeout: 60_000 });
    assertTrustedPortalPage(page, this.options.baseUrl);
    await page.locator('input[name="username"]').fill(this.options.username);
    await page.locator('button:has-text("Próxima"), a:has-text("Próxima")').first().click();
    const passwordField = page.locator('input[name="senha"], input[type="password"]').first();
    await passwordField.waitFor({ state: "visible" });
    // O eConsig cifra a senha no cliente e somente monta o campo RSA após
    // os eventos de teclado/blur do campo. `fill()` ignora essa sequência.
    await page.waitForFunction(() => typeof window.ValidaLogin === "function");
    await passwordField.click();
    await passwordField.pressSequentially(this.options.password);
    // O portal só consolida a senha cifrada após perder o foco; sem este
    // evento ele pode apresentar o CAPTCHA, mas recusar o login no envio.
    await passwordField.press("Tab");
    await page.waitForTimeout(150);
    this.setStatus("awaiting_captcha", "Digite o código de segurança exibido pelo eConsig/MS.");
    return this.status({ captchaImage: await this.captchaImage() });
  }

  async submitCaptcha(captcha) {
    if (!this.page || this.state !== "awaiting_captcha") throw new PortalError("LOGIN_NOT_PREPARED", "Inicie a conexão com o Mato Grosso do Sul antes de enviar o código.", 409);
    const code = clean(captcha);
    if (!code) throw new PortalError("CAPTCHA_REQUIRED", "Informe o código de segurança do Mato Grosso do Sul.", 400);
    const captchaInput = this.page.locator('input#captcha, input[placeholder*="código" i], input[name*="codigo" i], input[name*="captcha" i]').first();
    await captchaInput.click();
    await captchaInput.pressSequentially(code);
    const submit = this.page.locator('button:has-text("Entrar"), a:has-text("Entrar")').first();
    // O eConsig demora alguns segundos para validar e redirecionar. Não
    // interpretar o formulário ainda visível durante essa transição como erro.
    await Promise.all([
      this.page.waitForURL(/\/v3\/carregarPrincipal(?:\?|#|$)/, { timeout: 30_000 }).catch(() => null),
      submit.click(),
    ]);
    await this.page.waitForLoadState("domcontentloaded").catch(() => {});
    await this.page.waitForTimeout(300);
    if (await this.page.locator('input[type="password"]').isVisible().catch(() => false)) {
      const message = await this.feedback();
      this.setStatus("awaiting_captcha", "O eConsig/MS não confirmou o login.");
      throw new PortalError("CAPTCHA_REJECTED", message || "Código de segurança, usuário ou senha não aceitos pelo eConsig/MS.", 422, { captchaImage: await this.captchaImage() });
    }
    await this.page.locator('.main-menu, .nav-bar').first().waitFor({ state: "visible" });
    this.setStatus("connected", "eConsig/MS conectado e pronto para consultar.");
    return this.status();
  }

  async queryMargin(cpf, parameters = {}) {
    if (this.state !== "connected") throw new PortalError("PORTAL_NOT_CONNECTED", "Conecte o Mato Grosso do Sul antes de consultar.", 409);
    const registration = normalizeRegistration(parameters.registration);
    try {
      assertTrustedPortalPage(this.page, this.options.baseUrl);
      // O eConsig pode manter a barra lateral recolhida após o login. O
      // botão existe no DOM, mas às vezes está visualmente oculto; o clique
      // forçado reproduz a abertura da barra antes de acessar seus links.
      await this.page.waitForLoadState('load');
      await this.page.mouse.move(2, 200);
      const operational = this.page.locator('a[href="#menuOperacional"]').first();
      await operational.hover();
      const sideMenuToggle = this.page.locator("#btn-navbar");
      if (!await operational.isVisible() && await sideMenuToggle.isVisible().catch(() => false)) {
        // Em viewport reduzido ele pode ficar tecnicamente fora da tela,
        // embora o evento onclick do portal esteja disponível. Acionar esse
        // evento evita falhar antes de abrir o menu.
        await sideMenuToggle.click();
        await this.page.waitForTimeout(250);
      }
      // No eConsig atual, "Consultar Margem" é um submenu oculto até que
      // "Operacional" seja aberto. Clicar diretamente no link invisível
      // fazia a consulta expirar sem sequer chegar à página de pesquisa.
      if (await operational.getAttribute('aria-expanded') !== 'true') await operational.click();
      const menu = this.page.locator('a[onclick*="../v3/consultarMargem"]:visible, a[onclick*="consultarMargem"]:visible, a:has-text("Consultar Margem"):visible').first();
      await menu.waitFor({ state: "visible", timeout: 10_000 });
      await Promise.all([
        this.page.waitForURL(/\/v3\/consultarMargem(?:\?|#|$)/, { timeout: 20_000 }),
        menu.click(),
      ]);
      await this.page.waitForLoadState("domcontentloaded").catch(() => {});
      assertTrustedPortalPage(this.page, this.options.baseUrl);
      const cpfField = this.page.locator('input[name="SER_CPF"], input[name*="cpf" i], input[id*="cpf" i], input[placeholder*="CPF" i]').first();
      await cpfField.waitFor({ state: "visible", timeout: 20_000 });
      const registrationField = this.page.locator('input[name="RSE_MATRICULA"], input[name*="matricula" i], input[id*="matricula" i], input[placeholder*="matrícula" i]').first();
      if (registration && await registrationField.count()) {
        await registrationField.fill(registration);
        await registrationField.press("Tab");
      }
      await cpfField.fill(formatCpf(cpf));
      await cpfField.press("Tab");
      await this.page.waitForTimeout(250);
      // O eConsig pede um CAPTCHA também nesta etapa. Não clicar em
      // "Pesquisar" sem ele: o próprio portal responde "O código
      // informado é inválido" e descarta a pesquisa.
      const queryCaptcha = this.page.locator('input[name="codigo"], input#codigo, input[placeholder*="código" i], input[name*="captcha" i]').first();
      await queryCaptcha.waitFor({ state: "visible", timeout: 15_000 });
      this.pendingQuery = { cpf, registration };
      return {
        requiresCaptcha: true,
        challengeType: "query_captcha",
        portal: this.options.queryPortalId,
        portalName: this.options.name,
        captchaImage: await this.captchaImage(),
      };
    } catch (error) {
      const feedback = await this.feedback().catch(() => "");
      await writeDiagnostic("prepare-query-margin", error, this.page, feedback).catch(() => {});
      if (error instanceof PortalError) throw error;
      throw new PortalError("PORTAL_QUERY_FAILED", feedback || "O eConsig/MS não conseguiu preparar a consulta.", 422);
    }
  }

  async submitQueryCaptcha(captcha) {
    if (!this.pendingQuery) throw new PortalError("QUERY_NOT_PREPARED", "Inicie a consulta do Mato Grosso do Sul antes de enviar o código.", 409);
    const code = clean(captcha);
    if (!code) throw new PortalError("CAPTCHA_REQUIRED", "Informe o código de segurança exibido na consulta do Mato Grosso do Sul.", 422);

    const { cpf, registration } = this.pendingQuery;
    try {
      const queryCaptcha = this.page.locator('input[name="codigo"], input#codigo, input[placeholder*="código" i], input[name*="captcha" i]').first();
      await queryCaptcha.fill(code);
      await queryCaptcha.press('Tab');
      const search = this.page.locator('a#btnEnvia, a[name="btnEnvia"], a[onclick*="validaSubmit"], button:has-text("Pesquisar"), button:has-text("Consultar"), a:has-text("Pesquisar")').first();
      await Promise.all([
        this.page.waitForNavigation({ waitUntil: 'domcontentloaded', timeout: 30_000 }),
        search.click(),
      ]);
      // O eConsig mantém um bloco de margem oculto no HTML da tela. A leitura
      // deve considerar somente os detalhes visíveis do resultado retornado.
      const resultFields = this.page.locator("dt:visible, dd:visible");
      await resultFields.first().waitFor({ state: "visible", timeout: 20_000 }).catch(() => {});
      const entries = await resultFields.evaluateAll((elements) => elements.map((element) => ({ type: element.tagName.toLowerCase(), text: element.textContent || "" })));
      const employments = readMatoGrossoDoSulDetails(entries, cpf, registration);
      if (!employments.length) {
        const feedback = await this.feedback();
        if (/c[oó]digo informado [ée] inv[aá]lido|captcha/i.test(feedback)) {
          throw new PortalError("CAPTCHA_REJECTED", feedback, 422, { captchaImage: await this.captchaImage() });
        }
        throw new PortalError("MARGIN_NOT_FOUND", feedback || "O eConsig/MS não apresentou matrículas com margem disponível para este CPF.", 404);
      }
      this.pendingQuery = null;
      return { portal: this.options.queryPortalId, connectionId: this.options.id, source: "real", cpf: formatCpf(cpf), queriedAt: new Date().toISOString(), employments };
    } catch (error) {
      const feedback = await this.feedback().catch(() => "");
      await writeDiagnostic("submit-query-captcha", error, this.page, feedback).catch(() => {});
      if (error instanceof PortalError) throw error;
      throw new PortalError("PORTAL_QUERY_FAILED", feedback || "O eConsig/MS não concluiu a operação. Consulte o log técnico da integração.", 422);
    }
  }

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null; this.context = null; this.browser = null;
    this.pendingQuery = null;
    this.setStatus("disconnected", "Integração encerrada.");
  }
}
