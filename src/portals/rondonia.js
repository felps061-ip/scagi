import { formatCpf } from "../cpf.js";
import { PortalError } from "./errors.js";
import { assertTrustedPortalPage } from "./trusted-origin.js";

const LOGIN_HASH = "#/";
const PRIVATE_HASH = "#/privado/index";
// A rota de reserva exige uma permissão diferente e responde "Acesso não
// autorizado" para o perfil de consulta. Esta é a tela oficial de pesquisa
// de servidor, confirmada no portal autenticado.
const SEARCH_HASH = "#/privado/averbacao/pesquisa";

function normalizeText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

export function hasRondoniaAvailableMargin(value) {
  const text = normalizeText(value);
  if (!text || text.includes("sem margem")) return false;
  const normalized = text
    .replace(/[^0-9,.-]/g, "")
    .replace(/\./g, "")
    .replace(",", ".");
  const amount = Number.parseFloat(normalized);
  return Number.isFinite(amount) && amount > 0;
}

export function parseRondoniaSingleResult(rawText) {
  const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
  const lines = String(rawText ?? "")
    .split(/\r?\n/)
    .map(clean)
    .filter(Boolean);
  const valueAfter = (label) => {
    const wanted = normalizeText(label);
    const index = lines.findIndex((line) => {
      const candidate = normalizeText(line);
      return candidate === wanted || candidate.startsWith(`${wanted}:`);
    });
    if (index < 0) return "Não informado";
    const separator = lines[index].indexOf(":");
    const inline = separator >= 0 ? clean(lines[index].slice(separator + 1)) : "";
    return inline || lines[index + 1] || "Não informado";
  };

  const registrationIndex = lines.findIndex((line) => normalizeText(line).startsWith("matricula"));
  const uppercaseCandidate = lines
    .slice(0, Math.max(0, registrationIndex))
    .reverse()
    .find((line) => {
      const letters = line.replace(/[^A-Za-zÀ-ÿ]/g, "");
      return (
        letters.length >= 5 &&
        line === line.toLocaleUpperCase("pt-BR") &&
        !/DADOS DO SERVIDOR|SELECIONAR SERVIDOR/i.test(line)
      );
    });

  return {
    name: uppercaseCandidate || (registrationIndex > 0 ? lines[registrationIndex - 1] : "Servidor"),
    registration: valueAfter("Matrícula"),
    cpf: valueAfter("CPF"),
    role: valueAfter("Cargo"),
    department: valueAfter("Lotação"),
    classification: valueAfter("Classificação"),
    availableMargin: valueAfter("Margem Disponível"),
    cardMargin: valueAfter("Margem Cartão"),
    benefitCardMargin: valueAfter("Margem Cartão Benefício"),
    hasServerSection: lines.some((line) => normalizeText(line).includes("dados do servidor")),
    hasMarginSection: lines.some((line) => normalizeText(line).startsWith("margem disponivel")),
  };
}

export class RondoniaPortal {
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
        "Não foi possível iniciar o navegador da integração com Rondônia.",
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
      .locator(".q-notification, .q-banner, [role=alert]")
      .allTextContents()
      .catch(() => []);
    return messages.map((message) => message.replace(/\s+/g, " ").trim()).filter(Boolean).join(" ");
  }

  selectionDialog() {
    // O portal mantém tabelas de fundo renderizadas atrás do modal. Restrinja
    // a leitura ao diálogo visível para não confundir "Nenhum registro" com
    // uma matrícula do servidor.
    return this.page.locator(".q-dialog:visible").filter({ hasText: /Selecionar Servidor/i }).last();
  }

  async waitForSearchResult() {
    // O Quasar abre o modal antes de preencher a tabela. Esperar apenas por
    // `tbody tr` liberava a execução na linha de fundo "Nenhum registro",
    // fazendo o SCAGI concluir incorretamente que não existiam matrículas.
    await this.page.waitForFunction(
      () => {
        const isVisible = (element) => {
          const style = window.getComputedStyle(element);
          return style.display !== "none" && style.visibility !== "hidden" && element.getClientRects().length > 0;
        };
        const dialogs = [...document.querySelectorAll(".q-dialog")]
          .filter((element) => isVisible(element) && /Selecionar Servidor/i.test(element.textContent || ""));
        const selectionReady = dialogs.some((element) => Boolean(element.querySelector('tbody tr input[type="radio"]')));
        const content = document.querySelector(".q-page-container")?.textContent || "";
        // A confirmação de login permanece no DOM por alguns segundos. Ela
        // não é um resultado de busca e não pode interromper a espera pela
        // tabela de matrículas.
        const feedback = [...document.querySelectorAll(".q-notification, [role=alert]")]
          .some((element) => (
            isVisible(element) &&
            /erro|indispon[ií]vel|n[aã]o foi poss[ií]vel|falha|inv[aá]lid/i.test(element.textContent || "")
          ));
        const singleResult = /Dados\s+do\s+Servidor/i.test(content) && /Matr[ií]cula\s*:/i.test(content);
        return selectionReady || singleResult || feedback;
      },
      null,
      { timeout: 40_000 },
    );
  }

  async dismissSelectionDialog() {
    const dialog = this.selectionDialog();
    if (!(await dialog.isVisible().catch(() => false))) return;

    const cancelButton = dialog.getByRole("button", { name: "Cancelar", exact: true });
    if (await cancelButton.isVisible().catch(() => false)) {
      await cancelButton.click({ force: true });
    } else {
      await this.page.keyboard.press("Escape");
    }
    await dialog.waitFor({ state: "hidden", timeout: 10_000 }).catch(() => {});
  }

  async openSearchPage() {
    await this.dismissSelectionDialog();
    if (this.page.url().includes(SEARCH_HASH)) {
      await this.page.goto(`${this.options.baseUrl}${PRIVATE_HASH}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
    }
    await this.page.goto(`${this.options.baseUrl}${SEARCH_HASH}`, {
      waitUntil: "domcontentloaded",
      timeout: 60_000,
    });
    await this.page.locator('input[name="cpf"]').waitFor({ state: "visible", timeout: 20_000 });
  }

  async prepareLogin() {
    const page = await this.ensurePage();
    this.setStatus("connecting", "Abrindo o portal de consignação do Governo de Rondônia.");

    try {
      await page.goto(`${this.options.baseUrl}${LOGIN_HASH}`, {
        waitUntil: "domcontentloaded",
        timeout: 60_000,
      });
      assertTrustedPortalPage(page, this.options.baseUrl);
      const username = page.locator('input[name="usuario"]');
      await page.waitForFunction(
        () =>
          window.location.hash.startsWith("#/privado/") ||
          Boolean(document.querySelector('input[name="usuario"]')),
        null,
        { timeout: 30_000 },
      );
      const authenticated = page.url().includes("#/privado/") && !(await username.isVisible().catch(() => false));
      if (authenticated) {
        this.setStatus("connected", "Portal de Rondônia conectado e pronto para consultar.");
        return this.status();
      }

      await username.waitFor({ state: "visible", timeout: 30_000 });
      await username.fill(this.options.username);
      await page.locator('input[name="senha"]').fill(this.options.password);
      await page.getByRole("button", { name: "Entrar", exact: true }).click();
      await page.waitForFunction(
        () => window.location.hash.startsWith("#/privado/") && !document.querySelector('input[name="usuario"]'),
        null,
        { timeout: 40_000 },
      );

      this.setStatus("connected", "Portal de Rondônia conectado e pronto para consultar.");
      return this.status();
    } catch (error) {
      if (error instanceof PortalError) throw error;
      const feedback = await this.feedbackText();
      this.setStatus("error", "O portal de Rondônia não confirmou o login.");
      throw new PortalError(
        "PORTAL_LOGIN_FAILED",
        feedback || "O portal de Rondônia não confirmou o login. Confira as credenciais.",
        502,
        { reason: error.message, url: page.url() },
      );
    }
  }

  async submitCaptcha() {
    return this.status();
  }

  async openRegistrationDetail(registration) {
    const dialog = this.selectionDialog();
    const rows = dialog.locator("tbody tr");
    // Não use :has() aqui: algumas versões do navegador do servidor não
    // resolvem esse seletor dentro do modal Quasar. Filtramos pelo HTML real.
    const rowIndex = await rows.evaluateAll((elements, expectedRegistration) => elements.findIndex((row) => (
      Boolean(row.querySelector('input[type="radio"]')) &&
      [...row.querySelectorAll("td")].some((cell) => cell.textContent?.replace(/\s+/g, " ").trim() === expectedRegistration)
    )), registration);
    if (rowIndex < 0) {
      throw new PortalError(
        "MARGIN_NOT_FOUND",
        "O portal de Rondônia não manteve a matrícula selecionada na lista.",
        404,
      );
    }
    const row = rows.nth(rowIndex);
    const choice = row.locator('input[type="radio"]');
    // O primeiro rádio vem marcado por padrão. Clicar na célula vazia não
    // alterava a escolha no Chromium invisível, então o detalhamento sempre
    // voltava para a primeira matrícula, inclusive quando ela não tinha
    // margem. Marque o controle real e confirme a alteração antes de seguir.
    await choice.check({ force: true }).catch(async () => {
      await choice.evaluate((input) => input.closest(".q-radio")?.click() || input.click());
    });
    if (!(await choice.isChecked())) {
      throw new PortalError(
        "PORTAL_SELECTION_FAILED",
        "O portal de Rondônia não confirmou a matrícula selecionada.",
        502,
      );
    }
    await dialog.getByRole("button", { name: "Confirmar", exact: true }).click();
    await this.page.waitForFunction(
      () => {
        const content = document.querySelector(".q-page-container")?.textContent || "";
        return /Dados\s+do\s+Servidor/i.test(content) && /Margem\s+Dispon[ií]vel/i.test(content);
      },
      null,
      { timeout: 30_000 },
    );
  }

  async queryMargin(cpf, { registration = "", pensioner = "no" } = {}) {
    if (this.state !== "connected") {
      throw new PortalError(
        "PORTAL_NOT_CONNECTED",
        "Conecte o Governo de Rondônia antes de consultar.",
        409,
      );
    }

    try {
      await this.openSearchPage();
      const cpfInput = this.page.locator('input[name="cpf"]');
      if (await this.page.locator('input[name="usuario"]').isVisible().catch(() => false)) {
        this.setStatus("disconnected", "A sessão do portal de Rondônia expirou.");
        throw new PortalError(
          "PORTAL_SESSION_EXPIRED",
          "A sessão do Governo de Rondônia expirou. Faça a conexão novamente.",
          409,
        );
      }

      await cpfInput.waitFor({ state: "visible", timeout: 30_000 });
      const registrationInput = this.page.locator('input[name="matricula"]');
      if (registration) {
        await this.fillDigits(
          registrationInput,
          registration,
          "PORTAL_REGISTRATION_FILL_FAILED",
          "O portal de Rondônia não manteve a matrícula preenchida.",
        );
      } else {
        await registrationInput.fill("").catch(() => {});
      }
      await this.fillDigits(
        cpfInput,
        cpf,
        "PORTAL_CPF_FILL_FAILED",
        "O portal de Rondônia não manteve o CPF preenchido.",
      );

      const pensionerOptions = this.page.locator('input[name="pensionista"]');
      if ((await pensionerOptions.count()) >= 2) {
        await pensionerOptions.nth(pensioner === "yes" ? 0 : 1).check({ force: true });
      }
      await this.page.locator(".q-notification").last().waitFor({ state: "hidden", timeout: 4_000 }).catch(() => {});
      await this.page.getByRole("button", { name: "Buscar Servidor", exact: true }).click();

      await this.waitForSearchResult();

      const multipleResult = await this.extractMultipleRegistrations();
      if (multipleResult.length) {
        const employments = [];
        for (const choice of multipleResult) {
          // A seleção visual do modal não é estável no Chromium invisível:
          // ele pode manter o primeiro rádio marcado. A própria averbação
          // aceita CPF + matrícula e abre diretamente o detalhamento certo.
          await this.openSearchPage();
          await this.fillDigits(
            this.page.locator('input[name="matricula"]'),
            choice.registration,
            "PORTAL_REGISTRATION_FILL_FAILED",
            "O portal de Rondônia não manteve a matrícula preenchida.",
          );
          await this.fillDigits(
            this.page.locator('input[name="cpf"]'),
            cpf,
            "PORTAL_CPF_FILL_FAILED",
            "O portal de Rondônia não manteve o CPF preenchido.",
          );
          const options = this.page.locator('input[name="pensionista"]');
          if ((await options.count()) >= 2) await options.nth(pensioner === "yes" ? 0 : 1).check({ force: true });
          await this.page.getByRole("button", { name: "Buscar Servidor", exact: true }).click();
          await this.waitForSearchResult();
          const detail = await this.extractSingleRegistration(cpf);
          employments.push(detail || choice);
        }
        return {
          portal: this.options.queryPortalId,
          connectionId: this.options.id,
          cpf: formatCpf(cpf),
          queriedAt: new Date().toISOString(),
          source: "real",
          view: "multiple",
          employments,
        };
      }

      const singleResult = await this.extractSingleRegistration(cpf);
      if (singleResult) {
        return {
          portal: this.options.queryPortalId,
          connectionId: this.options.id,
          cpf: formatCpf(cpf),
          queriedAt: new Date().toISOString(),
          source: "real",
          view: "single",
          employments: [singleResult],
        };
      }

      const feedback = await this.feedbackText();
      throw new PortalError(
        "MARGIN_NOT_FOUND",
        feedback || "O portal de Rondônia não encontrou o servidor informado.",
        404,
      );
    } catch (error) {
      if (error instanceof PortalError) throw error;
      throw new PortalError(
        "PORTAL_QUERY_FAILED",
        "Não foi possível concluir a consulta no portal de Rondônia.",
        502,
        { reason: error.message },
      );
    }
  }

  async extractMultipleRegistrations() {
    const dialog = this.selectionDialog();
    const rows = await dialog.locator("tbody tr").evaluateAll((elements) => {
      const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
      return elements.filter((row) => row.querySelector('input[type="radio"]')).map((row) => {
        const cells = [...row.querySelectorAll("td")].map((cell) => clean(cell.textContent));
        // A linha possui: rádio, matrícula, nome, CPF, sequência, margens e
        // uma célula técnica de paginação. Localize a matrícula em vez de
        // assumir que a primeira ou a última célula é um dado de negócio.
        const registrationIndex = cells.findIndex((cell) => /^\d+[\d-]*$/.test(cell));
        const values = registrationIndex >= 0 ? cells.slice(registrationIndex, registrationIndex + 6) : [];
        if (values.length < 6) return null;
        return {
          registration: values[0],
          name: values[1] || "Servidor",
          cpf: values[2] || "Não informado",
          sequence: values[3] || "Não informado",
          availableMargin: values[4] || "Não informado",
          cardMargin: values[5] || "Não informado",
        };
      }).filter(Boolean);
    });

    return rows
      .filter((row) => hasRondoniaAvailableMargin(row.availableMargin) || hasRondoniaAvailableMargin(row.cardMargin))
      .map((row) => ({
      name: row.name,
      agency: this.options.mockAgency,
      cpf: row.cpf,
      registration: row.registration,
      sequence: row.sequence,
      referenceMonth: "Não informado",
      nextPayrollProcessing: "Não informado",
      provision: "Matrículas encontradas",
      margins: [
        { product: "MARGEM DISPONÍVEL", value: row.availableMargin },
        { product: "MARGEM CARTÃO", value: row.cardMargin },
      ],
      }));
  }

  async extractSingleRegistration(cpf) {
    const content = await this.page.locator(".q-page-container").innerText();
    const data = parseRondoniaSingleResult(content);

    if (!data.hasServerSection || !data.hasMarginSection) return null;
    return {
      name: data.name,
      agency: this.options.mockAgency,
      registration: data.registration,
      referenceMonth: "Não informado",
      nextPayrollProcessing: "Não informado",
      provision: "Margens disponíveis",
      details: {
        cargo: data.role,
        lotacao: data.department,
        classificacao: data.classification,
      },
      margins: [
        { product: "MARGEM DISPONÍVEL", value: data.availableMargin },
        { product: "MARGEM CARTÃO", value: data.cardMargin },
        { product: "MARGEM CARTÃO BENEFÍCIO", value: data.benefitCardMargin },
      ],
      cpf: data.cpf === "Não informado" ? formatCpf(cpf) : data.cpf,
    };
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
