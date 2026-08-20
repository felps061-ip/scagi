import { formatCpf } from "../cpf.js";
import { PortalError } from "./errors.js";

const LOGIN_PATH = "/home?1";
const SEARCH_PATH = "/consignatario/pesquisarMargem";

export class PortalDoConsignado {
  constructor(options) {
    this.options = options;
    this.browser = null;
    this.context = null;
    this.page = null;
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
        "Não foi possível iniciar o navegador da integração.",
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

  async captchaImage() {
    const captcha = this.page.locator("#cipCaptchaImg");
    await captcha.waitFor({ state: "visible" });
    const image = await captcha.screenshot({ type: "png" });
    return `data:image/png;base64,${image.toString("base64")}`;
  }

  async fillMaskedDigits(locator, rawValue, errorCode, errorMessage) {
    const digits = String(rawValue ?? "").replace(/\D/g, "");
    await locator.click();
    await locator.fill("");
    await locator.pressSequentially(digits, { delay: 35 });
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

  async prepareLogin() {
    const page = await this.ensurePage();
    this.setStatus("connecting", `Abrindo ${this.options.name}.`);

    const response = await page.goto(`${this.options.baseUrl}${LOGIN_PATH}`, {
      waitUntil: "domcontentloaded",
      timeout: 30_000,
    });

    let usernameVisible = await page
      .locator("#username")
      .isVisible()
      .catch(() => false);
    if (!usernameVisible) {
      const administrativeLoginTab = page.getByText("Login Administrativo", { exact: true }).first();
      if (await administrativeLoginTab.isVisible().catch(() => false)) {
        await administrativeLoginTab.click();
        await page
          .locator("#username")
          .waitFor({ state: "visible", timeout: 15_000 })
          .catch(() => {});
        usernameVisible = await page.locator("#username").isVisible().catch(() => false);
      }
    }

    if (!usernameVisible) {
      const pageSummary = await page
        .locator("body")
        .innerText({ timeout: 3_000 })
        .catch(() => "");
      this.setStatus("error", "A tela de login esperada não foi carregada.");
      throw new PortalError(
        "PORTAL_LOGIN_PAGE_UNAVAILABLE",
        "O Portal do Consignado respondeu, mas não exibiu a tela de login esperada.",
        502,
        {
          url: page.url(),
          httpStatus: response?.status() || null,
          title: await page.title().catch(() => ""),
          pageSummary: pageSummary.replace(/\s+/g, " ").trim().slice(0, 500),
        },
      );
    }

    await this.fillMaskedDigits(
      page.locator("#username"),
      this.options.username,
      "PORTAL_USERNAME_FILL_FAILED",
      "O Portal do Consignado não manteve o CPF de acesso preenchido.",
    );
    await page.locator("#password").fill(this.options.password);

    this.setStatus("awaiting_captcha", "Digite o CAPTCHA exibido para concluir a conexão.");
    return this.status({ captchaImage: await this.captchaImage() });
  }

  async submitCaptcha(captcha) {
    if (!this.page || this.page.isClosed() || this.state !== "awaiting_captcha") {
      throw new PortalError(
        "LOGIN_NOT_PREPARED",
        "Inicie a conexão antes de enviar o CAPTCHA.",
        409,
      );
    }

    const normalizedCaptcha = String(captcha ?? "").trim();
    if (!normalizedCaptcha) {
      throw new PortalError("CAPTCHA_REQUIRED", "Informe o CAPTCHA.", 400);
    }

    await this.page.locator("#captcha").fill(normalizedCaptcha);
    await this.page
      .locator('input[name="loginButton"][type="button"], input.botaoAcessar')
      .first()
      .click();

    try {
      await this.page.waitForFunction(
        () => window.location.pathname.startsWith("/consignatario"),
        null,
        { timeout: 20_000 },
      );
      this.setStatus("connected", "Portal conectado e pronto para consultar.");
      return this.status();
    } catch {
      const loginStillVisible = await this.page.locator("#captcha").isVisible().catch(() => false);
      if (!loginStillVisible) {
        this.setStatus("error", "O portal não confirmou o login.");
        throw new PortalError(
          "PORTAL_LOGIN_FAILED",
          "O portal não confirmou o login. Tente iniciar a conexão novamente.",
          502,
        );
      }

      const feedback = await this.page
        .locator(".feedbackPanelERROR, .feedbackPanel, .erro, .alerta")
        .allTextContents()
        .catch(() => []);
      this.setStatus("awaiting_captcha", "CAPTCHA não aceito. Confira a imagem atualizada.");
      throw new PortalError(
        "CAPTCHA_REJECTED",
        feedback.map((item) => item.trim()).filter(Boolean).join(" ") || this.message,
        422,
        { captchaImage: await this.captchaImage() },
      );
    }
  }

  async queryMargin(cpf) {
    if (this.state !== "connected") {
      throw new PortalError(
        "PORTAL_NOT_CONNECTED",
        "Conecte o Portal do Consignado antes de consultar.",
        409,
      );
    }

    try {
      await this.page.goto(`${this.options.baseUrl}${SEARCH_PATH}`, {
        waitUntil: "domcontentloaded",
        timeout: 30_000,
      });

      if (await this.page.locator("#username").isVisible().catch(() => false)) {
        this.setStatus("disconnected", "A sessão do portal expirou.");
        throw new PortalError(
          "PORTAL_SESSION_EXPIRED",
          "A sessão do portal expirou. Faça a conexão novamente.",
          409,
        );
      }

      const cpfInput = this.page.locator("#cpfServidor");
      await this.fillMaskedDigits(
        cpfInput,
        cpf,
        "PORTAL_CPF_FILL_FAILED",
        "O Portal do Consignado não manteve o CPF preenchido. Tente a consulta novamente.",
      );

      await this.page
        .locator('input[name="botaoPesquisar"][type="button"], input[value="Pesquisar"][type="button"]')
        .first()
        .click();

      await this.page.waitForFunction(
        () => {
          const result = document.querySelector('[id="painelMargensDisponiveis"] table tbody tr');
          const feedback = document.querySelector("#idcc, .feedbackPanelERROR, .feedbackPanel");
          const visibleFeedback = feedback && feedback.getClientRects().length > 0 && feedback.textContent.trim();
          return Boolean(result || visibleFeedback);
        },
        null,
        { timeout: 30_000 },
      );

      const hasResult = await this.page
        .locator('[id="painelMargensDisponiveis"] table tbody tr')
        .first()
        .isVisible()
        .catch(() => false);
      if (!hasResult) {
        const feedback = await this.page
          .locator("#idcc, .feedbackPanelERROR, .feedbackPanel")
          .allTextContents()
          .catch(() => []);
        throw new PortalError(
          "MARGIN_NOT_FOUND",
          feedback.map((item) => item.trim()).filter(Boolean).join(" ") ||
            "O portal não encontrou margem para o CPF informado.",
          404,
        );
      }

      const result = await this.page.evaluate(() => {
        const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
        const valueAfterDash = (container, label) => {
          const item = [...container.querySelectorAll(".dados")].find((element) =>
            clean(element.textContent).toLocaleLowerCase("pt-BR").startsWith(label.toLocaleLowerCase("pt-BR")),
          );
          if (!item) return "Não informado";
          return clean(item.textContent).replace(/^.*?\s-\s/, "") || "Não informado";
        };

        return [...document.querySelectorAll('[id="painelMargensDisponiveis"]')]
          .map((panel) => {
            const table = panel.querySelector("table");
            const provisionTitle = [...panel.querySelectorAll(".tituloTb")].find((element) =>
              clean(element.textContent).toLocaleLowerCase("pt-BR").includes("provimento"),
            );
            const resultBlock = panel.closest(".blocoDados") || panel.parentElement;
            const server = resultBlock?.querySelector("#divResultadoServidor") || document;
            const margins = [...(table?.querySelectorAll("tbody tr") || [])]
              .map((row) => {
                const cells = row.querySelectorAll("td");
                return {
                  product: clean(cells[0]?.textContent),
                  value: clean(cells[1]?.textContent),
                };
              })
              .filter((row) => row.product && row.value);

            return {
              name: valueAfterDash(server, "Nome"),
              agency: valueAfterDash(server, "Órgão"),
              registration: valueAfterDash(server, "Identificação"),
              referenceMonth: valueAfterDash(server, "Mês de Referência da Margem"),
              nextPayrollProcessing: valueAfterDash(
                server,
                "Data de Processamento da Próxima Folha",
              ),
              provision: clean(provisionTitle?.textContent) || "Provimento 1",
              margins,
            };
          })
          .filter((employment) => employment.margins.length > 0);
      });

      if (!result.length) {
        throw new PortalError(
          "MARGIN_NOT_FOUND",
          "O portal respondeu, mas não apresentou a Margem Disponível do Provimento 1.",
          404,
        );
      }

      return {
        portal: this.options.queryPortalId,
        connectionId: this.options.id,
        cpf: formatCpf(cpf),
        queriedAt: new Date().toISOString(),
        source: "real",
        employments: result,
      };
    } catch (error) {
      if (error instanceof PortalError) throw error;
      throw new PortalError(
        "PORTAL_QUERY_FAILED",
        "Não foi possível concluir a consulta no Portal do Consignado.",
        502,
        { reason: error.message },
      );
    }
  }

  async close() {
    await this.context?.close().catch(() => {});
    await this.browser?.close().catch(() => {});
    this.page = null;
    this.context = null;
    this.browser = null;
    this.setStatus("disconnected", "Integração encerrada.");
  }
}
