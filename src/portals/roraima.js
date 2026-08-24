import { formatCpf } from "../cpf.js";
import { PortalError } from "./errors.js";

const PROFILE_SELECTOR = "#idEmpresaConsignataria\\:empresaConsignataria";
const EVENT_SELECTOR = "#idEventoRubricaVerba\\:input_idEvento";
const COMPANY_VALUES = { sgg: "11097", sigrh: "11098" };

function cleanText(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

export function parseRoraimaMargin(rawText) {
  const match = cleanText(rawText).match(
    /\bMargem\s*:?\s*(?:R\$\s*)?(-?[\d.]+,\d{2}|Sem\s+Margem)/i,
  );
  return match ? cleanText(match[1]) : null;
}

export function parseRoraimaServerRows(rows) {
  return rows
    .map((cells) => cells.map(cleanText))
    .filter((cells) => cells.length >= 4)
    .map((cells) => ({
      cpf: cells[0] || "Não informado",
      name: cells[1] || "Servidor",
      registration: cells[2] || "Não informado",
      lastPayroll: cells[3] || "Não informado",
    }));
}

function valueAfterLabel(rawText, label) {
  const text = cleanText(rawText);
  const escaped = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const match = text.match(new RegExp(`${escaped}\\s*:?\\s*([^:]+?)(?=\\s+[A-ZÁÉÍÓÚÂÊÔÃÕÇ][^:]{1,40}:|$)`, "i"));
  return cleanText(match?.[1]) || "Não informado";
}

export class RoraimaPortal {
  constructor(options) {
    this.options = options;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.profileUrl = null;
    this.state = "disconnected";
    this.updatedAt = new Date().toISOString();
    this.message = "Conexão com o portal ainda não iniciada.";
  }

  status(extra = {}) {
    return {
      state: this.state,
      mode: "real",
      updatedAt: this.updatedAt,
      message: this.message,
      ...extra,
    };
  }

  setStatus(state, message) {
    this.state = state;
    this.message = message;
    this.updatedAt = new Date().toISOString();
  }

  async ensurePage() {
    if (this.page && !this.page.isClosed()) return this.page;

    let playwright;
    try {
      playwright = await import("playwright");
    } catch {
      throw new PortalError(
        "PLAYWRIGHT_NOT_INSTALLED",
        "O Playwright não está instalado. Execute npm install antes de ativar o modo real.",
        503,
      );
    }

    const launchOptions = { headless: false };
    if (this.options.browserChannel) launchOptions.channel = this.options.browserChannel;

    try {
      this.browser = await playwright.chromium.launch(launchOptions);
    } catch (error) {
      throw new PortalError(
        "BROWSER_START_FAILED",
        "Não foi possível abrir a janela do portal de Roraima para confirmar o reCAPTCHA.",
        503,
        { reason: error.message },
      );
    }

    this.context = await this.browser.newContext({
      locale: "pt-BR",
      viewport: { width: 1440, height: 1000 },
    });
    this.page = await this.context.newPage();
    this.page.setDefaultTimeout(20_000);
    return this.page;
  }

  loginUrl() {
    const baseUrl = this.options.baseUrl.replace(/\/$/, "");
    const loginPath = this.options.loginPath.startsWith("/")
      ? this.options.loginPath
      : `/${this.options.loginPath}`;
    return `${baseUrl}${loginPath}`;
  }

  async feedbackText() {
    const messages = await this.page
      .locator(".bf-messages, .ui-messages, [role=alert]")
      .allTextContents()
      .catch(() => []);
    return messages.map(cleanText).filter(Boolean).join(" ");
  }

  async isLoginVisible() {
    return this.page.locator("#username").isVisible().catch(() => false);
  }

  async isProfileVisible() {
    return this.page.locator(PROFILE_SELECTOR).isVisible().catch(() => false);
  }

  async isRecaptchaSolved() {
    return this.page.evaluate(() => {
      const response = document.querySelector('[name="g-recaptcha-response"]')?.value?.trim();
      if (response) return true;
      try {
        return Boolean(window.grecaptcha?.getResponse?.()?.trim());
      } catch {
        return false;
      }
    });
  }

  async prepareLogin() {
    const page = await this.ensurePage();
    this.setStatus("connecting", "Abrindo o portal consignado do Governo de Roraima.");

    try {
      await page.goto(this.loginUrl(), {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });

      const consignatariaAccess = page.locator('[id$=":btnConsignataria"]');
      if (await consignatariaAccess.isVisible().catch(() => false)) {
        await Promise.all([
          page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45_000 }),
          consignatariaAccess.click(),
        ]);
      }

      if (await this.isProfileVisible()) {
        this.profileUrl = page.url();
        this.setStatus("connected", "Portal de Roraima conectado e pronto para consultar.");
        return this.status();
      }

      const username = page.locator("#username");
      await username.waitFor({ state: "visible", timeout: 30_000 });
      await username.fill(this.options.username);
      await page.locator("#password").fill(this.options.password);
      await page.locator(".g-recaptcha, iframe[src*='recaptcha']").first().scrollIntoViewIfNeeded().catch(() => {});
      await page.bringToFront();

      this.setStatus(
        "awaiting_captcha",
        "Marque o código de segurança na janela oficial do portal de Roraima.",
      );
      return this.status({
        externalCaptcha: true,
        externalCaptchaMessage:
          "Na janela do portal de Roraima, marque ‘Não sou um robô’. Depois volte ao SCAGI e confirme.",
      });
    } catch (error) {
      if (error instanceof PortalError) throw error;
      this.setStatus("error", "Não foi possível preparar o login de Roraima.");
      throw new PortalError(
        "PORTAL_LOGIN_FAILED",
        "Não foi possível preparar o acesso ao portal de Roraima.",
        502,
        { reason: error.message, url: page.url() },
      );
    }
  }

  async submitCaptcha() {
    const page = await this.ensurePage();
    if (this.state === "connected" && (await this.isProfileVisible())) return this.status();

    if (!(await this.isLoginVisible())) {
      throw new PortalError(
        "PORTAL_LOGIN_STATE_INVALID",
        "A janela de login de Roraima não está mais disponível. Inicie a conexão novamente.",
        409,
      );
    }

    if (!(await this.isRecaptchaSolved())) {
      throw new PortalError(
        "CAPTCHA_REQUIRED",
        "Marque ‘Não sou um robô’ na janela do portal de Roraima antes de continuar.",
        422,
        { externalCaptcha: true },
      );
    }

    try {
      await Promise.all([
        page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null),
        page.locator("#submit").click(),
      ]);
      await page.locator(PROFILE_SELECTOR).waitFor({ state: "visible", timeout: 30_000 });
      this.profileUrl = page.url();
      this.setStatus("connected", "Portal de Roraima conectado e pronto para consultar.");
      return this.status();
    } catch (error) {
      const feedback = await this.feedbackText();
      if (await this.isLoginVisible()) {
        this.setStatus("awaiting_captcha", "O portal de Roraima não confirmou o login.");
        throw new PortalError(
          "PORTAL_LOGIN_FAILED",
          feedback || "O portal de Roraima não confirmou o login. Confira o reCAPTCHA e as credenciais.",
          422,
          { externalCaptcha: true, reason: error.message },
        );
      }
      this.setStatus("error", "O portal de Roraima não confirmou o login.");
      throw new PortalError(
        "PORTAL_LOGIN_FAILED",
        feedback || "O portal de Roraima não confirmou o login.",
        502,
        { reason: error.message, url: page.url() },
      );
    }
  }

  async waitForAjax(action) {
    const response = this.page.waitForResponse(
      (candidate) =>
        candidate.request().method() === "POST" &&
        candidate.url().startsWith(this.options.baseUrl),
      { timeout: 30_000 },
    ).catch(() => null);
    await action();
    await response;
    await this.page.waitForTimeout(250);
    await this.page.waitForFunction(
      () => !window.PrimeFaces?.ajax?.Queue || window.PrimeFaces.ajax.Queue.isEmpty(),
      null,
      { timeout: 15_000 },
    ).catch(() => {});
  }

  async returnToProfile() {
    if (await this.isProfileVisible()) return;
    if (!this.profileUrl) {
      throw new PortalError(
        "PORTAL_SESSION_EXPIRED",
        "A seleção SGG/SIGRH de Roraima expirou. Faça a conexão novamente.",
        409,
      );
    }
    await this.page.goto(this.profileUrl, { waitUntil: "domcontentloaded", timeout: 60_000 });
    if (await this.isLoginVisible()) {
      this.setStatus("disconnected", "A sessão do portal de Roraima expirou.");
      throw new PortalError(
        "PORTAL_SESSION_EXPIRED",
        "A sessão do Governo de Roraima expirou. Faça a conexão novamente.",
        409,
      );
    }
    await this.page.locator(PROFILE_SELECTOR).waitFor({ state: "visible", timeout: 30_000 });
  }

  async enterOperational(company) {
    await this.returnToProfile();
    const profile = this.page.locator(PROFILE_SELECTOR);
    await this.waitForAjax(() => profile.selectOption(COMPANY_VALUES[company]));
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 45_000 }).catch(() => null),
      this.page.locator("#btnAcessarSistema").click(),
    ]);
    await this.page.locator("#submenuContrato > a").waitFor({ state: "visible", timeout: 30_000 });
  }

  async openMarginSearch() {
    await this.page.locator("#submenuContrato > a").click();
    await this.page.locator("#submenuContrato > ul > li:nth-child(1) > a").click();
    await this.page
      .locator("#submenuContrato > ul > li:nth-child(1) > ul > li:nth-child(1) > a")
      .click();
    await this.page.locator("#campo_cpf").waitFor({ state: "visible", timeout: 30_000 });
  }

  async queryMargin(cpf, parameters = {}) {
    if (this.state !== "connected") {
      throw new PortalError(
        "PORTAL_NOT_CONNECTED",
        "Conecte o Governo de Roraima antes de consultar.",
        409,
      );
    }

    const company = parameters.company === "sgg" ? "sgg" : "sigrh";
    try {
      await this.enterOperational(company);
      await this.openMarginSearch();

      const cpfInput = this.page.locator("#campo_cpf");
      await cpfInput.fill(formatCpf(cpf));
      await cpfInput.press("Tab");
      const maintainedCpf = (await cpfInput.inputValue()).replace(/\D/g, "");
      if (maintainedCpf !== cpf) {
        throw new PortalError(
          "PORTAL_CPF_FILL_FAILED",
          "O portal de Roraima não manteve o CPF preenchido.",
          502,
        );
      }

      await this.waitForAjax(() => this.page.locator("#botaoPesquisarColaborador").click());
      const resultRows = this.page.locator("#idTabelaColaborador_data tr").filter({
        has: this.page.locator('[id$=":btnPesqColaborador"]'),
      });
      const rowCount = await resultRows.count();
      if (!rowCount) {
        const feedback = await this.feedbackText();
        throw new PortalError(
          "MARGIN_NOT_FOUND",
          feedback || `O servidor não foi encontrado na base ${company.toUpperCase()} de Roraima.`,
          404,
        );
      }

      const rawRows = await resultRows.evaluateAll((rows) => rows.map((row) =>
        [...row.querySelectorAll("td")].map((cell) => cell.textContent),
      ));
      const serverRows = parseRoraimaServerRows(rawRows);
      const rowIndex = Math.max(0, serverRows.findIndex((row) => row.cpf.replace(/\D/g, "") === cpf));
      const server = serverRows[rowIndex] || serverRows[0];
      const selectServer = resultRows.nth(rowIndex).locator('[id$=":btnPesqColaborador"]');
      await this.waitForAjax(() => selectServer.click());

      const eventSelect = this.page.locator(EVENT_SELECTOR);
      await eventSelect.waitFor({ state: "visible", timeout: 30_000 });
      const eventOption = await eventSelect.locator("option").evaluateAll((options) => {
        const option = options.find((candidate) => /\b0810\b/.test(candidate.textContent || ""));
        return option ? { value: option.value, label: option.textContent.trim() } : null;
      });
      if (!eventOption?.value) {
        throw new PortalError(
          "MARGIN_CODE_NOT_FOUND",
          "O código 0810 - EMP. B. DAYCOVAL não está disponível para este servidor.",
          404,
        );
      }

      await this.waitForAjax(() => eventSelect.selectOption(eventOption.value));
      await this.page.waitForFunction(
        () => /\bMargem\s*:?\s*(?:R\$\s*)?(?:-?[\d.]+,\d{2}|Sem\s+Margem)/i.test(document.body.innerText),
        null,
        { timeout: 30_000 },
      );
      const pageText = await this.page.locator("body").innerText();
      const margin = parseRoraimaMargin(pageText);
      if (!margin) {
        throw new PortalError(
          "MARGIN_NOT_FOUND",
          "O portal de Roraima não apresentou a margem do código 0810.",
          404,
        );
      }

      return {
        portal: this.options.queryPortalId,
        connectionId: this.options.id,
        cpf: formatCpf(cpf),
        queriedAt: new Date().toISOString(),
        source: "real",
        employments: [{
          name: server.name,
          agency: `${this.options.mockAgency} (${company.toUpperCase()})`,
          registration: server.registration,
          referenceMonth: server.lastPayroll,
          nextPayrollProcessing: "Não informado",
          provision: `${eventOption.label} · ${company.toUpperCase()}`,
          details: {
            cargo: valueAfterLabel(pageText, "Cargo"),
            lotacao: valueAfterLabel(pageText, "Lotação"),
            classificacao: valueAfterLabel(pageText, "Contratação"),
          },
          margins: [{ product: "MARGEM EMPRÉSTIMO", value: margin }],
        }],
      };
    } catch (error) {
      if (error instanceof PortalError) throw error;
      if (await this.isLoginVisible()) {
        this.setStatus("disconnected", "A sessão do portal de Roraima expirou.");
        throw new PortalError(
          "PORTAL_SESSION_EXPIRED",
          "A sessão do Governo de Roraima expirou. Faça a conexão novamente.",
          409,
        );
      }
      throw new PortalError(
        "PORTAL_QUERY_FAILED",
        "Não foi possível concluir a consulta no portal de Roraima.",
        502,
        { reason: error.message, url: this.page.url() },
      );
    }
  }

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
    this.profileUrl = null;
    this.setStatus("disconnected", "Integração encerrada.");
  }
}
