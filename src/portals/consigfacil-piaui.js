import { formatCpf } from "../cpf.js";
import { normalizeRegistration } from "../registration.js";
import { PortalError } from "./errors.js";

const LOGIN_PATH = "/index.php";
const SEARCH_PATH = "/controlador.php?pagina=busca_servidor_consignatario.php";
const LOGIN_CAPTCHA = "form.login-form img.imagem-captcha, form[name=login] img[src*=\"captcha.php\"]";
const QUERY_CAPTCHA = "#form img.imagem-captcha, #form img[src*=\"captcha.php\"]";

export class ConsigfacilPiaui {
  constructor(options) {
    this.options = options;
    this.browser = null;
    this.context = null;
    this.page = null;
    this.pendingQuery = null;
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

    const launchOptions = { headless: this.options.headless };
    if (this.options.browserChannel) launchOptions.channel = this.options.browserChannel;

    try {
      this.browser = await playwright.chromium.launch(launchOptions);
    } catch (error) {
      throw new PortalError(
        "BROWSER_START_FAILED",
        "Não foi possível iniciar o navegador da integração com o ConsigFácil.",
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

  async captchaImage(selector) {
    const captcha = this.page.locator(selector).first();
    await captcha.waitFor({ state: "visible" });
    const image = await captcha.screenshot({ type: "png" });
    return `data:image/png;base64,${image.toString("base64")}`;
  }

  async fillDigits(locator, rawValue, errorCode, errorMessage) {
    const digits = String(rawValue ?? "").replace(/\D/g, "");
    await locator.click();
    await locator.fill("");
    await locator.pressSequentially(digits, { delay: 25 });
    await locator.press("Tab");

    let fieldDigits = (await locator.inputValue()).replace(/\D/g, "");
    if (fieldDigits !== digits) {
      await locator.evaluate((input, value) => {
        const valueSetter = Object.getOwnPropertyDescriptor(
          window.HTMLInputElement.prototype,
          "value",
        )?.set;
        valueSetter?.call(input, value);
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
        input.blur();
      }, digits);
      fieldDigits = (await locator.inputValue()).replace(/\D/g, "");
    }

    if (fieldDigits !== digits) {
      throw new PortalError(errorCode, errorMessage, 502);
    }
  }

  async feedbackText() {
    const messages = await this.page
      .locator(
        ".alert-danger, .alert-warning, .alert-dismissible, #alertPersonalizado .modal-body, .modal.show .modal-body, .toast.show",
      )
      .allTextContents()
      .catch(() => []);
    return messages.map((message) => message.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
  }

  async dismissOptionalNotice() {
    await this.page.keyboard.press("Escape").catch(() => {});
    const modal = this.page.locator(".modal.show").last();
    if (await modal.isVisible().catch(() => false)) {
      await modal.click({ position: { x: 5, y: 5 } }).catch(() => {});
      await modal.waitFor({ state: "hidden", timeout: 2_000 }).catch(() => {});
    }
  }

  async hasAuthenticatedPage() {
    return (await this.page.locator("#objeto_1069, #form #matricula").count()) > 0;
  }

  async prepareLogin() {
    const page = await this.ensurePage();
    this.pendingQuery = null;
    this.setStatus("connecting", `Abrindo o ConsigFácil de ${this.options.name}.`);

    const response = await page.goto(`${this.options.baseUrl}${LOGIN_PATH}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });
    const username = page.locator("#usuario");
    if (!(await username.isVisible().catch(() => false))) {
      const pageSummary = await page.locator("body").innerText().catch(() => "");
      this.setStatus("error", "A tela de login esperada não foi carregada.");
      throw new PortalError(
        "PORTAL_LOGIN_PAGE_UNAVAILABLE",
        "O ConsigFácil respondeu, mas não exibiu a tela de login esperada.",
        502,
        {
          url: page.url(),
          httpStatus: response?.status() || null,
          title: await page.title().catch(() => ""),
          pageSummary: pageSummary.replace(/\s+/g, " ").trim().slice(0, 500),
        },
      );
    }

    await this.fillDigits(
      username,
      this.options.username,
      "PORTAL_USERNAME_FILL_FAILED",
      "O ConsigFácil não manteve o login preenchido.",
    );
    await page.locator("#senha").fill(this.options.password);

    this.setStatus("awaiting_captcha", "Digite o CAPTCHA exibido para concluir a conexão.");
    return this.status({ captchaImage: await this.captchaImage(LOGIN_CAPTCHA) });
  }

  async submitCaptcha(captcha) {
    if (!this.page || this.page.isClosed() || this.state !== "awaiting_captcha") {
      throw new PortalError(
        "LOGIN_NOT_PREPARED",
        `Inicie a conexão com ${this.options.name} antes de enviar o CAPTCHA.`,
        409,
      );
    }

    const normalizedCaptcha = String(captcha ?? "").trim();
    if (!normalizedCaptcha) {
      throw new PortalError("CAPTCHA_REQUIRED", "Informe o CAPTCHA.", 400);
    }

    await this.page.locator("form.login-form #captcha, form[name=login] #captcha").fill(normalizedCaptcha);
    const navigation = this.page
      .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 })
      .catch(() => null);
    await this.page.locator("form.login-form button[type=submit], form[name=login] button[type=submit]").click();
    await navigation;

    let authenticated = await this.hasAuthenticatedPage();
    let loginVisible = await this.page.locator("#usuario").isVisible().catch(() => false);
    if (!authenticated && !loginVisible) {
      await this.page.goto(`${this.options.baseUrl}${SEARCH_PATH}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      }).catch(() => null);
      authenticated = await this.hasAuthenticatedPage();
      loginVisible = await this.page.locator("#usuario").isVisible().catch(() => false);
    }
    if (authenticated) {
      await this.dismissOptionalNotice();
      this.setStatus("connected", "ConsigFácil conectado e pronto para consultar.");
      return this.status();
    }

    if (!loginVisible) {
      const pageSummary = await this.page.locator("body").innerText().catch(() => "");
      this.setStatus("error", "O ConsigFácil não confirmou o login.");
      throw new PortalError(
        "PORTAL_LOGIN_FAILED",
        "O ConsigFácil não confirmou o login. Inicie a conexão novamente.",
        502,
        {
          url: this.page.url(),
          title: await this.page.title().catch(() => ""),
          pageSummary: pageSummary.replace(/\s+/g, " ").trim().slice(0, 500),
        },
      );
    }

    const feedback = await this.feedbackText();
    await this.fillDigits(
      this.page.locator("#usuario"),
      this.options.username,
      "PORTAL_USERNAME_FILL_FAILED",
      "O ConsigFácil não manteve o login preenchido.",
    );
    await this.page.locator("#senha").fill(this.options.password);
    this.setStatus("awaiting_captcha", "CAPTCHA não aceito. Confira a imagem atualizada.");
    throw new PortalError(
      "CAPTCHA_REJECTED",
      feedback || this.message,
      422,
      { captchaImage: await this.captchaImage(LOGIN_CAPTCHA) },
    );
  }

  async prepareQueryPage(cpf, registration) {
    await this.page.goto(`${this.options.baseUrl}${SEARCH_PATH}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    if (await this.page.locator("#usuario, form.login-form").first().isVisible().catch(() => false)) {
      this.pendingQuery = null;
      this.setStatus("disconnected", "A sessão do ConsigFácil expirou.");
      throw new PortalError(
        "PORTAL_SESSION_EXPIRED",
        `A sessão de ${this.options.name} expirou. Faça a conexão novamente.`,
        409,
      );
    }

    await this.dismissOptionalNotice();
    const form = this.page.locator("#form");
    await form.waitFor({ state: "visible" });
    await this.fillDigits(
      form.locator("#matricula"),
      registration,
      "PORTAL_REGISTRATION_FILL_FAILED",
      "O ConsigFácil não manteve a matrícula preenchida.",
    );
    await this.fillDigits(
      form.locator("#cpf"),
      cpf,
      "PORTAL_CPF_FILL_FAILED",
      "O ConsigFácil não manteve o CPF preenchido.",
    );
    this.pendingQuery = { cpf, registration };
    return this.captchaImage(QUERY_CAPTCHA);
  }

  async queryMargin(cpf, parameters = {}) {
    if (this.state !== "connected") {
      throw new PortalError(
        "PORTAL_NOT_CONNECTED",
        `Conecte ${this.options.name} antes de consultar.`,
        409,
      );
    }

    const registration = normalizeRegistration(parameters.registration);
    if (!registration) {
      throw new PortalError("REGISTRATION_REQUIRED", "Informe a matrícula do servidor.", 400);
    }

    try {
      const captchaImage = await this.prepareQueryPage(cpf, registration);
      return {
        requiresCaptcha: true,
        challengeType: "query_captcha",
        portal: this.options.queryPortalId,
        portalName: this.options.name,
        captchaImage,
      };
    } catch (error) {
      if (error instanceof PortalError) throw error;
      throw new PortalError(
        "PORTAL_QUERY_PREPARE_FAILED",
        "Não foi possível preparar a consulta no ConsigFácil.",
        502,
        { reason: error.message },
      );
    }
  }

  async submitQueryCaptcha(captcha) {
    if (!this.pendingQuery) {
      throw new PortalError(
        "QUERY_NOT_PREPARED",
        `Prepare a consulta de ${this.options.name} antes de enviar o CAPTCHA.`,
        409,
      );
    }
    const normalizedCaptcha = String(captcha ?? "").trim();
    if (!normalizedCaptcha) {
      throw new PortalError("CAPTCHA_REQUIRED", "Informe o CAPTCHA da consulta.", 400);
    }

    const { cpf, registration } = this.pendingQuery;
    try {
      await this.page.locator("#form #captcha").fill(normalizedCaptcha);
      const navigation = this.page
        .waitForNavigation({ waitUntil: "domcontentloaded", timeout: 30_000 })
        .catch(() => null);
      await this.page.locator('#form input[type="submit"][value="Pesquisar"]').click();
      await navigation;

      await this.page.waitForFunction(
        () => {
          if (document.querySelector("#conteudo table.table-consig tbody tr")) return true;
          const feedback = document.querySelector(
            ".alert-danger, .alert-warning, .alert-dismissible, #alertPersonalizado .modal-body, .modal.show .modal-body, .toast.show",
          );
          return Boolean(feedback?.textContent?.trim());
        },
        null,
        { timeout: 8_000 },
      ).catch(() => {});

      const resultRow = this.page.locator("#conteudo table.table-consig tbody tr").first();
      if ((await resultRow.count()) === 0) {
        const feedback = await this.feedbackText();
        if (/nenhum|não\s+(?:foi\s+)?encontr|não\s+localiz|inexistente/i.test(feedback)) {
          this.pendingQuery = null;
          throw new PortalError(
            "MARGIN_NOT_FOUND",
            feedback || "O ConsigFácil não encontrou o servidor informado.",
            404,
          );
        }

        const refreshedCaptcha = await this.prepareQueryPage(cpf, registration);
        throw new PortalError(
          "CAPTCHA_REJECTED",
          feedback || "CAPTCHA não aceito. Confira a nova imagem e tente novamente.",
          422,
          { captchaImage: refreshedCaptcha },
        );
      }

      const rowData = await resultRow.evaluate((row) => {
        const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
        const cells = row.querySelectorAll("td");
        return {
          agency: clean(cells[0]?.textContent),
          registration: clean(cells[1]?.textContent),
          name: clean(cells[2]?.textContent),
        };
      });

      const detailLink = resultRow.locator("td:nth-child(3) a").first();
      const detailHref = await detailLink.getAttribute("href");
      if (!detailHref) {
        throw new PortalError(
          "PORTAL_RESULT_LINK_MISSING",
          "O ConsigFácil encontrou o servidor, mas não apresentou o acesso às margens.",
          502,
        );
      }
      await this.page.goto(new URL(detailHref, this.page.url()).href, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });
      await this.page.locator("#container_card_margem").waitFor({ state: "attached", timeout: 30_000 });

      const margins = await this.page.evaluate(() => {
        const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
        const container = document.querySelector("#container_card_margem");
        if (!container) return [];

        let cards = [...container.querySelectorAll(".card")];
        if (!cards.length) cards = [...container.querySelectorAll(":scope > div > div")];
        const seen = new Set();
        return cards.flatMap((card) => {
          const text = clean(card.textContent);
          const valueMatch = text.match(/R\$\s*([\d.]+,\d{2})/i);
          if (!valueMatch) return [];
          const product = /consign[aá]vel/i.test(text)
            ? "MARGEM CONSIGNÁVEL"
            : /cart[aã]o/i.test(text)
              ? "MARGEM CARTÃO"
              : clean(card.querySelector(".badge, .card-title, h1, h2, h3, h4")?.textContent) || "MARGEM";
          const key = `${product}:${valueMatch[1]}`;
          if (seen.has(key)) return [];
          seen.add(key);
          return [{ product, value: valueMatch[1] }];
        });
      });

      if (!margins.length) {
        throw new PortalError(
          "MARGIN_NOT_FOUND",
          "O ConsigFácil abriu o servidor, mas não apresentou os cartões de margem.",
          404,
        );
      }

      this.pendingQuery = null;
      return {
        portal: this.options.queryPortalId,
        connectionId: this.options.id,
        cpf: formatCpf(cpf),
        queriedAt: new Date().toISOString(),
        source: "real",
        employments: [
          {
            name: rowData.name || "Servidor consultado",
            agency: rowData.agency || this.options.mockAgency || this.options.name.toUpperCase(),
            registration: rowData.registration || registration,
            referenceMonth: "Não informado",
            nextPayrollProcessing: "Não informado",
            provision: "Margens disponíveis",
            margins,
          },
        ],
      };
    } catch (error) {
      if (error instanceof PortalError) throw error;
      this.pendingQuery = null;
      throw new PortalError(
        "PORTAL_QUERY_FAILED",
        "Não foi possível concluir a consulta no ConsigFácil.",
        502,
        { reason: error.message },
      );
    }
  }

  cancelPendingQuery() {
    this.pendingQuery = null;
  }

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
    this.pendingQuery = null;
    this.setStatus("disconnected", "Integração encerrada.");
  }
}
