import { PortalError } from "./errors.js";

export function assertTrustedPortalPage(page, baseUrl) {
  const expected = new URL(baseUrl);
  const current = new URL(page.url());
  if (expected.protocol !== "https:" || current.protocol !== "https:" || current.origin !== expected.origin) {
    throw new PortalError(
      "PORTAL_UNTRUSTED_ORIGIN",
      "A página de autenticação do portal não está no domínio autorizado. As credenciais não foram enviadas.",
      502,
    );
  }
}
