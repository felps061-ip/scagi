import { PortalDoConsignado } from "./portal-do-consignado.js";
import { PortalError } from "./errors.js";
import { assertTrustedPortalPage } from "./trusted-origin.js";
import { formatCpf } from "../cpf.js";
import { normalizeRegistration } from "../registration.js";

const clean = (value) => String(value ?? "").replace(/\s+/g, " ").trim();
export async function readAcreResult(page) {
  // The result is a readonly form: innerText does not contain input values.
  await page.locator("#body_margemTextBox[readonly]").waitFor({ state: "visible" });
  const fields = {
    name: "#body_clienteTextBox",
    registration: "#body_matriculaTextBox",
    serverType: "#body_categoriaTextBox",
    cpf: "#body_cpf_nascimentoTextBox",
    birthDate: "#body_dataNascimentoTextBox",
    margin: "#body_margemTextBox",
  };
  return Object.fromEntries(await Promise.all(Object.entries(fields).map(async ([field, selector]) =>
    [field, clean(await page.locator(`${selector}[readonly]`).inputValue())],
  )));
}

export function validateAcreResult(data, cpf, registration) {
  if (!data.name || !data.serverType || !data.birthDate || !/^-?[\d.]+,\d{2}$/.test(data.margin || "")) {
    throw new PortalError("PORTAL_RESULT_INVALID", "O Acre não apresentou todos os dados esperados. Envie o HTML da tela de resultado ao suporte.", 502);
  }
  if (String(data.cpf).replace(/\D/g, "") !== cpf || normalizeRegistration(data.registration) !== registration) {
    throw new PortalError("PORTAL_RESULT_MISMATCH", "O resultado do Acre não corresponde ao CPF e à matrícula consultados.", 502);
  }
  return data;
}

export class AcrePortal extends PortalDoConsignado {
  async settle() {
    await this.page.waitForLoadState("domcontentloaded");
    await this.page.waitForFunction(() => !window.Sys?.WebForms?.PageRequestManager?.getInstance()?.get_isInAsyncPostBack());
    assertTrustedPortalPage(this.page, this.options.baseUrl);
  }

  async postback(locator) {
    await Promise.all([
      this.page.waitForNavigation({ waitUntil: "domcontentloaded", timeout: 15000 }).catch(() => null),
      locator.click(),
    ]);
    await this.settle();
  }

  async captchaImage() {
    const image = this.page.locator("#imgCaptcha");
    await image.waitFor({ state: "visible" });
    await image.evaluate((img) => img.complete && img.naturalWidth > 0 || new Promise((resolve, reject) => {
      img.addEventListener("load", resolve, { once: true });
      img.addEventListener("error", () => reject(new Error("Falha ao carregar CAPTCHA")), { once: true });
    }));
    return `data:image/png;base64,${(await image.screenshot({ type: "png" })).toString("base64")}`;
  }

  async feedback() {
    return (await this.page.locator('[role="alert"]:visible, .validation-summary-errors:visible, [id*="lblMensagem"]:visible, [id*="lblErro"]:visible, #ucAjaxModalPopup_lblMensagem:visible').allTextContents()).map(clean).filter(Boolean).join(" ");
  }

  async prepareLogin() {
    await this.ensurePage();
    this.setStatus("connecting", "Abrindo o Governo do Acre.");
    try {
      await this.page.goto(`${this.options.baseUrl}/Login.aspx`, { waitUntil: "domcontentloaded", timeout: 60000 });
      assertTrustedPortalPage(this.page, this.options.baseUrl);
      if (await this.page.locator("#txtLogin").isVisible()) {
        await this.page.locator("#txtLogin").fill(this.options.username);
        // ASP.NET updates the login panel on change. Wait before filling the password.
        await Promise.all([
          this.page.waitForResponse((r) => r.request().method() === "POST" && new URL(r.url()).origin === new URL(this.options.baseUrl).origin, { timeout: 15000 }),
          this.page.locator("#txtLogin").press("Tab"),
        ]);
        await this.settle();
        await this.page.locator("#txtSenha").fill(this.options.password);
        if (await this.page.locator("#txtCaptcha").isVisible()) {
          this.setStatus("awaiting_captcha", "Digite o CAPTCHA do Governo do Acre.");
          return this.status({ captchaImage: await this.captchaImage() });
        }
        return await this.submitCaptcha("");
      }
      return await this.finishLogin();
    } catch (error) {
      this.setStatus("error", "Não foi possível preparar o acesso ao Acre.");
      if (error instanceof PortalError) throw error;
      throw new PortalError("PORTAL_LOGIN_FAILED", "Não foi possível preparar o acesso ao Governo do Acre.", 502);
    }
  }

  async finishLogin() {
    assertTrustedPortalPage(this.page, this.options.baseUrl);
    const organization = this.page.locator("#gvOrgao_imgEntrar_0");
    if (await organization.isVisible()) await this.postback(organization);
    await this.page.locator("#cssmenu").waitFor({ state: "visible" });
    this.setStatus("connected", "Governo do Acre conectado.");
    return this.status();
  }

  async submitCaptcha(captcha) {
    if (!this.page) throw new PortalError("PORTAL_NOT_CONNECTED", "Inicie a conexão com o Acre.", 409);
    assertTrustedPortalPage(this.page, this.options.baseUrl);
    if (await this.page.locator("#txtCaptcha").isVisible()) {
      if (!clean(captcha)) throw new PortalError("CAPTCHA_REQUIRED", "Informe o CAPTCHA do Acre.", 422);
      await this.page.locator("#txtCaptcha").fill(clean(captcha));
    }
    await this.page.locator("#txtSenha").fill(this.options.password);
    await this.postback(this.page.locator("#Entrar"));
    if (await this.page.locator("#txtLogin").isVisible()) {
      const visible = await this.page.locator("#imgCaptcha").isVisible();
      this.setStatus(visible ? "awaiting_captcha" : "error", "O Acre não confirmou o login.");
      throw new PortalError("PORTAL_LOGIN_FAILED", await this.feedback() || "O Acre não confirmou o login. Confira as credenciais e o CAPTCHA.", 422, visible ? { captchaImage: await this.captchaImage() } : {});
    }
    return this.finishLogin();
  }

  async queryMargin(cpf, parameters = {}) {
    const registration = normalizeRegistration(parameters.registration);
    if (!registration) throw new PortalError("REGISTRATION_REQUIRED", "Informe a matrícula do servidor do Acre.", 400);
    if (this.state !== "connected") throw new PortalError("PORTAL_NOT_CONNECTED", "Conecte o Governo do Acre.", 409);
    try {
      assertTrustedPortalPage(this.page, this.options.baseUrl);
      await this.page.locator("#cssmenu > ul > li:nth-child(4) > a").click();
      await this.postback(this.page.locator("#cssmenu > ul > li:nth-child(4) > ul > li:nth-child(1) > a"));
      await this.fillMaskedDigits(this.page.locator("#body_matriculaTextBox"), registration, "PORTAL_REGISTRATION_FILL_FAILED", "O Acre não manteve a matrícula informada.");
      await this.fillMaskedDigits(this.page.locator("#body_cpfTextBox"), cpf, "PORTAL_CPF_FILL_FAILED", "O Acre não manteve o CPF informado.");
      const search = this.page.getByRole("button", { name: /^(prosseguir|consultar(?: margem)?|pesquisar|buscar)$/i });
      if (await search.count() !== 1) throw new PortalError("PORTAL_SEARCH_UNAVAILABLE", "Não foi possível identificar o botão de pesquisa do Acre. Envie o HTML da página de consulta ao suporte.", 502);
      await this.postback(search);
      const data = validateAcreResult(await readAcreResult(this.page), cpf, registration);
      return {
        portal: this.options.queryPortalId, connectionId: this.options.id, source: "real",
        cpf: formatCpf(cpf), queriedAt: new Date().toISOString(),
        employments: [{ name: data.name, registration: data.registration, agency: this.options.mockAgency,
          referenceMonth: "Não informado", nextPayrollProcessing: "Não informado", provision: "Margem consignável",
          details: { serverType: data.serverType, birthDate: data.birthDate },
          margins: [{ product: "MARGEM DISPONÍVEL", value: data.margin }],
        }],
      };
    } catch (error) {
      if (await this.page.locator("#txtLogin").isVisible().catch(() => false)) {
        this.setStatus("disconnected", "A sessão do Acre expirou.");
        throw new PortalError("PORTAL_SESSION_EXPIRED", "A sessão do Acre expirou. Conecte novamente.", 409);
      }
      if (error instanceof PortalError) throw error;
      throw new PortalError("PORTAL_QUERY_FAILED", "Não foi possível concluir a consulta no Governo do Acre.", 502);
    }
  }
}
