const state = {
  user: null,
  portal: null,
  portals: new Map(),
  activePortalId: null,
  activeQueryChallengeId: null,
  activeUsername: null,
  portalMode: "mock",
  activeExternalCaptcha: false,
  history: [],
  historyCpfMask: null,
};

const portalMetadata = {
  piaui: {
    code: "PI",
    flagClass: "flag-pi",
    requiresRegistration: true,
    transparencyUrl: "https://transparencia.pi.gov.br/servidores",
  },
  pernambuco: {
    code: "PE",
    flagClass: "flag-pe",
    requiresRegistration: true,
    transparencyUrl: "https://transparencia.pe.gov.br/recursos-humanos/remuneracoes/",
  },
  rondonia: { code: "RO", flagClass: "flag-ro" },
  maranhao: {
    code: "MA",
    flagClass: "flag-ma",
    requiresRegistration: true,
  },
  roraima: {
    code: "RR",
    flagClass: "flag-rr",
    requiresCompany: true,
  },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
const roleLabels = {
  admin: "Administrador",
  supervisor: "Supervisor",
  operator: "Vendedor",
};

function canManageUsers() {
  return ["admin", "supervisor"].includes(state.user?.role);
}

async function api(path, options = {}) {
  const response = await fetch(path, {
    ...options,
    headers: { "Content-Type": "application/json", ...(options.headers || {}) },
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(payload.error?.message || "Não foi possível concluir a operação.");
    error.code = payload.error?.code;
    error.details = payload.error?.details;
    error.status = response.status;
    if (response.status === 401 && path !== "/api/auth/login") showLogin();
    throw error;
  }
  return payload;
}

function showToast(message, type = "error", detail = "") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  if (detail) {
    const title = document.createElement("strong");
    const description = document.createElement("span");
    title.textContent = message;
    description.textContent = detail;
    toast.append(title, description);
  } else {
    toast.textContent = message;
  }
  $("#toast-region").append(toast);
  setTimeout(() => toast.remove(), 4200);
}

function describeError(error, context = "operation") {
  const descriptions = {
    INVALID_CPF: ["CPF inválido", "O CPF informado está incompleto ou possui dígitos inválidos.", "Confira o CPF do cliente."],
    REGISTRATION_REQUIRED: ["Matrícula obrigatória", "Este portal exige a matrícula do servidor para realizar a consulta.", "Informe a matrícula e tente novamente."],
    INVALID_PORTAL: ["Portal inválido", "A averbadora selecionada não está disponível.", "Selecione outro portal."],
    PORTAL_NOT_CONNECTED: ["Portal não conectado", "A consulta não pode começar porque não existe um acesso conectado para essa averbadora.", "Abra Integrações e conecte o acesso."],
    PORTAL_SESSION_EXPIRED: ["Sessão do portal expirada", "O portal encerrou a sessão utilizada pelo SCAGI.", "Reconecte o acesso em Integrações."],
    PORTAL_BUSY: ["Portal ocupado", "Este acesso está finalizando outra consulta ou aguardando uma confirmação.", "Aguarde alguns instantes e tente novamente."],
    MARGIN_NOT_FOUND: ["Margem não encontrada", "O portal não retornou uma margem para os dados informados.", "Confira CPF, matrícula e base selecionada."],
    PORTAL_LOGIN_FAILED: ["Falha no acesso ao portal", "O portal recusou ou não concluiu a autenticação.", "Confira a conexão, o CAPTCHA e as credenciais cadastradas."],
    CAPTCHA_REQUIRED: ["Confirmação de segurança pendente", "O portal ainda aguarda a confirmação do CAPTCHA.", "Conclua a confirmação e tente novamente."],
    CAPTCHA_REJECTED: ["Código de segurança recusado", "O CAPTCHA informado não foi aceito ou expirou.", "Gere outro código e tente novamente."],
    QUERY_CHALLENGE_INVALID: ["Confirmação expirada", "A confirmação desta consulta não é mais válida.", "Inicie uma nova consulta."],
    MARGIN_CODE_NOT_FOUND: ["Convênio indisponível", "O portal não disponibilizou o código de margem necessário para este servidor.", "Confirme o vínculo no portal responsável."],
    PORTAL_CPF_FILL_FAILED: ["CPF não aceito pelo portal", "O portal apagou ou recusou o CPF informado.", "Confira o CPF e tente novamente."],
    USER_EXISTS: ["Usuário já existente", "Já existe um acesso com esse nome de usuário.", "Escolha outro nome."],
    WEAK_PASSWORD: ["Senha não aceita", "A senha não atende aos requisitos mínimos de segurança.", "Use pelo menos 8 caracteres."],
    INTERNAL_ERROR: ["Falha inesperada no SCAGI", "O servidor não conseguiu concluir a operação.", "Tente novamente. Se persistir, informe o horário do erro ao suporte."],
  };
  if (descriptions[error.code]) return descriptions[error.code];
  if (error.status === 401) return ["Sessão encerrada", "Seu acesso ao SCAGI expirou.", "Entre novamente para continuar."];
  if (error.status >= 500) return ["Portal temporariamente indisponível", error.message || "O portal não respondeu como esperado.", "Aguarde alguns minutos e tente novamente."];
  return [context === "query" ? "Não foi possível consultar o cliente" : "Não foi possível concluir", error.message || "A operação não pôde ser concluída.", "Confira os dados e tente novamente."];
}

function showErrorToast(error) {
  const [title, reason, action] = describeError(error);
  showToast(title, "error", `${reason} ${action}`);
}

function hideQueryError() {
  $("#query-error-result").hidden = true;
}

function showQueryError(error) {
  const [title, reason, action] = describeError(error, "query");
  $("#query-error-title").textContent = title;
  $("#query-error-message").textContent = reason;
  $("#query-error-action").textContent = action;
  $("#query-error-integrations").hidden = !["PORTAL_NOT_CONNECTED", "PORTAL_SESSION_EXPIRED", "PORTAL_LOGIN_FAILED"].includes(error.code);
  $("#query-error-history").hidden = error.code !== "CPF_ALREADY_QUERIED";
  $("#empty-result").hidden = true;
  $("#result-card").hidden = true;
  $("#multiple-result-card").hidden = true;
  $("#loading-result").hidden = true;
  $("#query-error-result").hidden = false;
}

function showLogin() {
  $("#app-view").hidden = true;
  $("#login-view").hidden = false;
  $("#login-password").value = "";
}

function showApp() {
  $("#login-view").hidden = true;
  $("#app-view").hidden = false;
  const username = state.user?.username || "Operador";
  $("#current-user").textContent = username;
  $("#current-user-role").textContent = roleLabels[state.user?.role] || "Vendedor";
  $("#current-user-avatar").textContent = username.slice(0, 2).toUpperCase();
  $("#users-nav-item").hidden = !canManageUsers();
  const isAdmin = state.user?.role === "admin";
  $("#create-user-form").classList.toggle("supervisor-create-card", !isAdmin);
  $("#new-user-role-field").hidden = !isAdmin;
  $("#new-user-role").disabled = !isAdmin;
  $("#new-user-role").value = "operator";
  $("#new-user-title").textContent = isAdmin ? "Novo acesso" : "Novo vendedor";
  $("#new-user-description").textContent = isAdmin
    ? "Crie vendedores ou supervisores para a equipe."
    : "Supervisores podem criar somente acessos de vendedores.";
  $("#create-user-button").textContent = isAdmin ? "Criar acesso" : "Criar vendedor";
  loadPortals();
}

function formatStatus(portal) {
  const labels = {
    connected: "Portal conectado",
    awaiting_captcha: "Aguardando CAPTCHA",
    connecting: "Conectando…",
    disconnected: "Portal desconectado",
    error: "Falha na conexão",
  };
  return portal.mode === "mock" ? "Demonstração ativa" : labels[portal.state] || "Status desconhecido";
}

function selectedConnections() {
  const queryPortalId = $("#portal-select").value;
  return [...state.portals.values()].filter(
    (portal) => portal.queryPortalId === queryPortalId,
  );
}

function updateQueryFields() {
  const metadata = portalMetadata[$("#portal-select").value];
  const requiresRegistration = Boolean(metadata?.requiresRegistration);
  const registrationField = $("#registration-field");
  const registrationInput = $("#registration-input");
  const requiresCompany = Boolean(metadata?.requiresCompany);
  const companyField = $("#company-field");
  registrationField.hidden = !requiresRegistration;
  registrationInput.required = requiresRegistration;
  companyField.hidden = !requiresCompany;
  $(".query-grid").classList.toggle("with-registration", requiresRegistration || requiresCompany);
  const flag = $("#portal-flag");
  flag.textContent = metadata?.code || "SP";
  flag.className = `government-flag ${metadata?.flagClass || "flag-sp"}`;
  const registrationHelpLink = $("#registration-help-link");
  registrationHelpLink.hidden = !metadata?.transparencyUrl;
  if (metadata?.transparencyUrl) registrationHelpLink.href = metadata.transparencyUrl;
}

function renderSelectedPortal() {
  updateQueryFields();
  const connections = selectedConnections();
  const connected = connections.filter((portal) => portal.state === "connected");
  const connectionToOpen = connections.find((portal) => portal.state !== "connected") || connections[0];
  state.portal = connections[0] || null;
  const pill = $("#portal-pill");
  const connectButton = $("#query-connect-button");
  if (!connections.length) {
    pill.className = "portal-pill warning";
    pill.innerHTML = "<span></span> Portal indisponível";
    connectButton.hidden = true;
    delete connectButton.dataset.connectPortal;
    $("#query-button").disabled = true;
    return;
  }
  pill.className = `portal-pill ${connected.length ? "connected" : "warning"}`;
  const statusLabel = connections.length > 1
    ? `${connected.length}/${connections.length} acessos conectados`
    : formatStatus(connections[0]);
  pill.innerHTML = `<span></span> ${escapeHtml(statusLabel)}`;
  connectButton.hidden = false;
  connectButton.dataset.connectPortal = connectionToOpen.id;
  const allConnected = connected.length === connections.length && connectionToOpen.mode === "real";
  connectButton.classList.toggle("button-connected", allConnected);
  connectButton.textContent = allConnected
    ? "Reconectar acesso"
    : "Conectar acesso";
  $("#query-button").disabled = connected.length === 0;
}

function renderPortal(portal) {
  state.portals.set(portal.id, portal);
  const statusElement = $(`[data-integration-status="${portal.id}"]`);
  if (statusElement) {
    statusElement.textContent = `${formatStatus(portal)} · ${portal.message}`;
  }
  const connectButtons = $$(`[data-connect-portal="${portal.id}"]`);
  connectButtons.forEach((connectButton) => {
    connectButton.hidden = false;
    const isConnected = portal.state === "connected" && portal.mode === "real";
    connectButton.classList.toggle("button-connected", isConnected);
    connectButton.textContent = isConnected
      ? "Reconectar acesso"
      : "Conectar acesso";
  });
}

async function loadPortals() {
  try {
    const payload = await api("/api/portals");
    state.portals.clear();
    payload.portals.forEach(renderPortal);
    renderSelectedPortal();
  } catch (error) {
    showErrorToast(error);
  }
}

function switchView(name) {
  if (name === "users" && !canManageUsers()) name = "query";
  $$(".view").forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
  });
  $$(".nav-item[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  const labels = { query: "Consultar margem", integrations: "Integrações", history: "Histórico", users: "Vendedores" };
  $("#breadcrumb-current").textContent = labels[name];
  $(".sidebar").classList.remove("open");
  if (name === "history") loadHistory();
  if (name === "integrations") loadPortals();
  if (name === "users") loadUsers();
}

function formatCpfInput(value) {
  const digits = value.replace(/\D/g, "").slice(0, 11);
  return digits
    .replace(/^(\d{3})(\d)/, "$1.$2")
    .replace(/^(\d{3})\.(\d{3})(\d)/, "$1.$2.$3")
    .replace(/(\d{3})(\d{1,2})$/, "$1-$2");
}

function escapeHtml(value) {
  const element = document.createElement("span");
  element.textContent = String(value ?? "");
  return element.innerHTML;
}

function renderResult(result) {
  if (result.view === "multiple" || result.employments.length > 1) {
    renderMultipleResult(result);
    return;
  }
  const employment = result.employments[0];
  $("#result-name").textContent = employment.name;
  $("#result-meta").textContent = employment.details
    ? `${employment.agency} · Matrícula ${employment.registration}`
    : `${employment.agency} · Identificação ${employment.registration} · Próxima folha ${employment.nextPayrollProcessing}`;
  $("#result-cpf").textContent = result.cpf;
  $("#result-provision").textContent = employment.provision;
  $("#result-reference").textContent = `Referência ${employment.referenceMonth}`;
  $("#result-time").textContent = `Consultado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(result.queriedAt))}`;
  const details = employment.details || {};
  const detailItems = [
    ["Cargo", details.cargo],
    ["Lotação", details.lotacao],
    ["Classificação", details.classificacao],
  ].filter(([, value]) => value && value !== "Não informado");
  $("#result-details").hidden = detailItems.length === 0;
  $("#result-details").innerHTML = detailItems
    .map(([label, value]) => `<div><span>${label}</span><strong>${escapeHtml(value)}</strong></div>`)
    .join("");
  $("#margin-grid").innerHTML = employment.margins
    .map((margin) => {
      const isCurrency = /^\s*(?:R\$\s*)?-?[\d.]+,\d{2}\s*$/.test(margin.value);
      return `<div class="margin-item"><span>${escapeHtml(margin.product)}</span><strong class="${isCurrency ? "" : "non-currency"}">${escapeHtml(margin.value)}</strong></div>`;
    })
    .join("");
  $("#empty-result").hidden = true;
  $("#loading-result").hidden = true;
  $("#multiple-result-card").hidden = true;
  $("#result-card").hidden = false;
}

function renderMultipleResult(result) {
  const marginValue = (employment, product) => employment.margins.find(
    (margin) => margin.product === product,
  )?.value || "Não informado";
  $("#multiple-result-cpf").textContent = result.cpf;
  $("#multiple-result-time").textContent = `Consultado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(result.queriedAt))}`;
  $("#multiple-result-body").innerHTML = result.employments.map((employment) => `<tr>
    <td><strong>${escapeHtml(employment.registration)}</strong></td>
    <td>${escapeHtml(employment.name)}</td>
    <td>${escapeHtml(employment.cpf || result.cpf)}</td>
    <td>${escapeHtml(employment.sequence || "—")}</td>
    <td>${escapeHtml(marginValue(employment, "MARGEM DISPONÍVEL"))}</td>
    <td>${escapeHtml(marginValue(employment, "MARGEM CARTÃO"))}</td>
  </tr>`).join("");
  $("#empty-result").hidden = true;
  $("#loading-result").hidden = true;
  $("#result-card").hidden = true;
  $("#multiple-result-card").hidden = false;
}

function resetQueryResult() {
  $("#cpf-input").value = "";
  $("#registration-input").value = "";
  $("#result-card").hidden = true;
  $("#multiple-result-card").hidden = true;
  $("#empty-result").hidden = false;
  hideQueryError();
  $("#cpf-input").focus();
}

function renderHistory() {
  const search = $("#history-search").value.trim().toLowerCase();
  const searchingFullCpf = search.replace(/\D/g, "").length === 11;
  const history = state.history.filter((item) => (
    (!state.historyCpfMask || item.cpf === state.historyCpfMask)
    && (searchingFullCpf || !search || [item.portal, item.cpf, item.actor, item.status]
      .some((value) => String(value || "").toLowerCase().includes(search))
    )
  ));
  $("#history-body").innerHTML = history.length
      ? history.map((item) => `<tr>
          <td>${escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.startedAt)))}</td>
          <td>${escapeHtml(item.portal)}</td><td>${escapeHtml(item.cpf)}</td><td>${escapeHtml(item.actor)}</td>
          <td><span class="history-status ${item.status}">${item.status === "success" ? "Sucesso" : "Falha"}</span></td>
          <td>${item.status === "success" && item.details?.length ? `<button class="button button-secondary" data-history-detail="${escapeHtml(item.id)}" type="button">Ver margem</button>` : "—"}</td>
        </tr>`).join("")
      : `<tr><td colspan="6" class="empty-table">${state.history.length ? "Nenhuma consulta encontrada." : "Nenhuma consulta nas últimas 24 horas."}</td></tr>`;
}

async function loadHistory(cpf = "") {
  try {
    const digits = String(cpf).replace(/\D/g, "");
    const { history } = await api(digits.length === 11 ? `/api/history?cpf=${encodeURIComponent(digits)}` : "/api/history");
    state.history = history;
    renderHistory();
  } catch (error) {
    showErrorToast(error);
  }
}

$("#history-search").addEventListener("input", () => {
  state.historyCpfMask = null;
  const digits = $("#history-search").value.replace(/\D/g, "");
  if (digits.length === 11) {
    loadHistory(digits);
    return;
  }
  renderHistory();
});

function showHistoryDetails(item) {
  state.activeHistoryItem = item;
  $("#history-detail-meta").textContent = `${item.portal} · CPF ${item.cpf} · ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.finishedAt || item.startedAt))}`;
  $("#history-detail-content").innerHTML = item.details.map((detail, index) => `
    <article class="history-detail-item">
      <header><span>RESULTADO ${String(index + 1).padStart(2, "0")}</span><h3>${escapeHtml(detail.provision || "Margens disponíveis")}</h3></header>
      <div class="history-detail-summary">
        <div><span>Órgão</span><strong>${escapeHtml(detail.agency)}</strong></div>
        <div><span>Matrícula</span><strong>${escapeHtml(detail.registration)}</strong></div>
        <div><span>Referência</span><strong>${escapeHtml(detail.referenceMonth)}</strong></div>
      </div>
      <table class="history-detail-margins"><caption>Valores disponíveis</caption><tbody>${detail.margins.map((margin) => `<tr><td><span class="margin-dot"></span>${escapeHtml(margin.product)}</td><td>${escapeHtml(margin.value)}</td></tr>`).join("")}</tbody></table>
    </article>`).join("");
  $("#history-detail-dialog").showModal();
}

function pdfText(value) {
  return String(value || "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^\x20-\x7e]/g, " ")
    .replace(/\\/g, "\\\\")
    .replace(/\(/g, "\\(")
    .replace(/\)/g, "\\)");
}

function downloadHistoryPdf(item) {
  const commands = [];
  const text = (value, x, y, size = 12, bold = false, color = "0 0 0") => {
    commands.push(`${color} rg BT /${bold ? "F2" : "F1"} ${size} Tf ${x} ${y} Td (${pdfText(value)}) Tj ET`);
  };
  const box = (x, y, width, height, color) => commands.push(`${color} rg ${x} ${y} ${width} ${height} re f`);
  const truncate = (value, length = 58) => {
    const clean = String(value || "Não informado");
    return clean.length > length ? `${clean.slice(0, length - 1)}...` : clean;
  };
  const formattedDate = new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.finishedAt || item.startedAt));

  box(0, 0, 595, 842, "0.98 0.97 0.94");
  box(0, 648, 595, 194, "0.08 0.07 0.05");
  box(0, 640, 595, 8, "0.80 0.61 0.12");
  text("SCAGI  |  GRUPO IMPERIO", 48, 796, 10, true, "0.95 0.80 0.35");
  text("Comprovante de consulta", 48, 754, 28, true, "1 1 1");
  text("Margens registradas com CPF protegido", 48, 730, 12, false, "0.82 0.80 0.74");
  text(`Portal: ${truncate(item.portal, 55)}`, 48, 690, 11, false, "1 1 1");
  text(`CPF: ${item.cpf}   |   ${formattedDate}`, 48, 672, 11, false, "1 1 1");

  let y = 600;
  item.details.slice(0, 3).forEach((detail, index) => {
    box(48, y - 38, 499, 38, "0.16 0.13 0.08");
    text(`RESULTADO ${String(index + 1).padStart(2, "0")}`, 64, y - 16, 9, true, "0.95 0.80 0.35");
    text(truncate(detail.provision, 48), 64, y - 31, 16, true, "1 1 1");
    y -= 61;

    box(48, y - 55, 499, 55, "1 1 1");
    text("ORGAO", 64, y - 17, 8, true, "0.48 0.45 0.39");
    text(truncate(detail.agency, 24), 64, y - 34, 11, true, "0.12 0.11 0.09");
    text("MATRICULA", 245, y - 17, 8, true, "0.48 0.45 0.39");
    text(truncate(detail.registration, 18), 245, y - 34, 11, true, "0.12 0.11 0.09");
    text("REFERENCIA", 408, y - 17, 8, true, "0.48 0.45 0.39");
    text(truncate(detail.referenceMonth, 14), 408, y - 34, 11, true, "0.12 0.11 0.09");
    y -= 77;

    text("VALORES DISPONIVEIS", 64, y, 9, true, "0.48 0.45 0.39");
    y -= 16;
    detail.margins.slice(0, 8).forEach((margin, marginIndex) => {
      box(48, y - 29, 499, 29, marginIndex % 2 ? "0.98 0.97 0.94" : "1 1 1");
      text(truncate(margin.product, 45), 64, y - 19, 11, true, "0.20 0.18 0.14");
      const amount = pdfText(margin.value);
      text(amount, 490 - (amount.length * 8), y - 20, 15, true, "0.02 0.40 0.25");
      y -= 29;
    });
    y -= 24;
  });
  text("Documento gerado pelo SCAGI. Uso restrito a consultas autorizadas.", 48, 36, 8, false, "0.43 0.40 0.35");
  const content = commands.join("\n");
  const encoder = (text) => Uint8Array.from([...text].map((character) => character.charCodeAt(0) & 0xff));
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 5 0 R /F2 6 0 R >> >> /Contents 4 0 R >>",
    `<< /Length ${encoder(content).length} >>\nstream\n${content}\nendstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica-Bold >>",
  ];
  let pdf = "%PDF-1.4\n";
  const offsets = [0];
  objects.forEach((object, index) => {
    offsets.push(encoder(pdf).length);
    pdf += `${index + 1} 0 obj\n${object}\nendobj\n`;
  });
  const xref = encoder(pdf).length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n${offsets.slice(1).map((offset) => `${String(offset).padStart(10, "0")} 00000 n \n`).join("")}trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF`;
  const url = URL.createObjectURL(new Blob([encoder(pdf)], { type: "application/pdf" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `scagi-margens-${new Date(item.finishedAt || item.startedAt).toISOString().slice(0, 10)}.pdf`;
  link.click();
  URL.revokeObjectURL(url);
}

$("#history-body").addEventListener("click", (event) => {
  const button = event.target.closest("[data-history-detail]");
  if (!button) return;
  const item = state.history.find(({ id }) => id === button.dataset.historyDetail);
  if (item?.details?.length) showHistoryDetails(item);
});
$("#close-history-detail-dialog").addEventListener("click", () => $("#history-detail-dialog").close());
$("#download-history-pdf").addEventListener("click", () => {
  if (state.activeHistoryItem?.details?.length) downloadHistoryPdf(state.activeHistoryItem);
});

async function loadUsers() {
  try {
    const { users } = await api("/api/users");
    $("#users-body").innerHTML = users.map((user) => `<tr>
      <td data-label="Usuário"><strong>${escapeHtml(user.username)}</strong></td>
      <td data-label="Perfil"><span class="user-role">${roleLabels[user.role] || "Vendedor"}</span></td>
      <td data-label="Criado em">${escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(user.createdAt)))}</td>
      <td data-label="Ações"><div class="user-actions">
        ${state.user?.role === "admin" || user.role === "operator" ? `<button class="button button-secondary" data-reset-user="${user.username}" type="button">Redefinir senha</button>` : ""}
        ${state.user?.role === "admin" && user.role !== "admin" ? `<button class="button button-danger" data-remove-user="${user.username}" type="button">Remover</button>` : ""}
      </div></td>
    </tr>`).join("");
  } catch (error) {
    showErrorToast(error);
  }
}

async function startConnection(portalId) {
  if (!portalId) return;
  state.activePortalId = portalId;
  const portal = state.portals.get(portalId);
  const buttons = $$(`[data-connect-portal="${portalId}"]`);
  buttons.forEach((button) => {
    button.disabled = true;
    button.textContent = "Abrindo portal…";
  });
  try {
    const status = await api(`/api/portals/${portalId}/connect`, { method: "POST" });
    if (status.captchaImage || status.externalCaptcha) {
      const externalCaptcha = Boolean(status.externalCaptcha);
      state.activeExternalCaptcha = externalCaptcha;
      $("#captcha-portal-name").textContent = (portal?.name || "Portal do Consignado").toUpperCase();
      $("#captcha-description").textContent = externalCaptcha
        ? status.externalCaptchaMessage || "Conclua o código de segurança na janela oficial do portal e confirme aqui."
        : "Digite os caracteres exibidos pelo portal. A imagem pertence à sessão segura mantida no servidor.";
      $("#captcha-image-wrap").hidden = externalCaptcha;
      $("#captcha-input-field").hidden = externalCaptcha;
      $("#captcha-input").required = !externalCaptcha;
      $("#refresh-captcha").textContent = externalCaptcha ? "Reabrir janela" : "Gerar outra imagem";
      $("#captcha-submit-button").textContent = externalCaptcha ? "Já confirmei no portal" : "Concluir conexão";
      if (status.captchaImage) $("#captcha-image").src = status.captchaImage;
      $("#captcha-input").value = "";
      $("#captcha-error").hidden = true;
      if (!$("#captcha-dialog").open) $("#captcha-dialog").showModal();
    } else {
      renderPortal({ ...portal, ...status });
      renderSelectedPortal();
      showToast("Portal pronto para consultas.", "success");
    }
  } catch (error) {
    showErrorToast(error);
  } finally {
    buttons.forEach((button) => {
      button.disabled = false;
      button.textContent = "Conectar acesso";
    });
    loadPortals();
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("#login-error").hidden = true;
  try {
    const payload = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({ username: $("#login-user").value, password: $("#login-password").value }),
    });
    state.user = payload.user;
    showApp();
  } catch (error) {
    $("#login-error").textContent = error.message;
    $("#login-error").hidden = false;
  } finally {
    button.disabled = false;
  }
});

$("#toggle-password").addEventListener("click", () => {
  const input = $("#login-password");
  input.type = input.type === "password" ? "text" : "password";
});

$("#logout-button").addEventListener("click", async () => {
  await api("/api/auth/logout", { method: "POST" }).catch(() => {});
  state.user = null;
  showLogin();
});

$$(".nav-item[data-view]").forEach((button) => button.addEventListener("click", () => switchView(button.dataset.view)));
$("#menu-button").addEventListener("click", () => $(".sidebar").classList.toggle("open"));
$("#cpf-input").addEventListener("input", (event) => { event.target.value = formatCpfInput(event.target.value); });
$("#portal-select").addEventListener("change", renderSelectedPortal);
$$('[data-connect-portal]').forEach((button) => {
  button.addEventListener("click", () => startConnection(button.dataset.connectPortal));
});
$("#query-connect-button").addEventListener("click", (event) => {
  startConnection(event.currentTarget.dataset.connectPortal);
});

$("#query-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  $("#query-button").disabled = true;
  $("#empty-result").hidden = true;
  $("#result-card").hidden = true;
  $("#multiple-result-card").hidden = true;
  $("#loading-result").hidden = false;
  hideQueryError();
  try {
    const result = await api("/api/margins/query", {
      method: "POST",
      body: JSON.stringify({
        portal: $("#portal-select").value,
        cpf: $("#cpf-input").value,
        registration: $("#registration-input").value,
        company: $("#company-select").value,
      }),
    });
    if (result.requiresCaptcha && result.challengeId) {
      state.activeQueryChallengeId = result.challengeId;
      $("#query-captcha-image").src = result.captchaImage;
      $("#query-captcha-input").value = "";
      $("#query-captcha-error").hidden = true;
      $("#query-captcha-portal-name").textContent = `${result.portalName || "ConsigFácil"} · CONSIGFÁCIL`;
      $("#loading-result").hidden = true;
      $("#empty-result").hidden = false;
      $("#query-captcha-dialog").showModal();
      $("#query-captcha-input").focus();
    } else {
      renderResult(result);
    }
  } catch (error) {
    showQueryError(error);
  } finally {
    await loadPortals();
  }
});

$("#query-error-retry").addEventListener("click", () => {
  hideQueryError();
  $("#empty-result").hidden = false;
  $("#cpf-input").focus();
});
$("#query-error-integrations").addEventListener("click", () => switchView("integrations"));
$("#query-error-history").addEventListener("click", async () => {
  const digits = $("#cpf-input").value.replace(/\D/g, "");
  state.historyCpfMask = null;
  $("#history-search").value = digits;
  switchView("history");
  await loadHistory(digits);
  $("#history-search").focus();
});

$("#new-query-button").addEventListener("click", resetQueryResult);
$("#new-multiple-query-button").addEventListener("click", resetQueryResult);

$("#create-user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  const requestedRole = state.user?.role === "admin" ? $("#new-user-role").value : "operator";
  button.disabled = true;
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: $("#new-user-username").value,
        password: $("#new-user-password").value,
        role: requestedRole,
      }),
    });
    event.currentTarget.reset();
    $("#new-user-role").value = "operator";
    await loadUsers();
    showToast(`${roleLabels[requestedRole]} criado com sucesso.`, "success");
  } catch (error) {
    showErrorToast(error);
  } finally {
    button.disabled = false;
  }
});

$("#users-body").addEventListener("click", async (event) => {
  const resetButton = event.target.closest("[data-reset-user]");
  if (resetButton) {
    state.activeUsername = resetButton.dataset.resetUser;
    $("#password-user-name").textContent = state.activeUsername;
    $("#reset-user-password").value = "";
    $("#user-password-dialog").showModal();
    return;
  }

  const removeButton = event.target.closest("[data-remove-user]");
  if (!removeButton) return;
  const username = removeButton.dataset.removeUser;
  if (!window.confirm(`Remover o acesso de ${username}?`)) return;
  removeButton.disabled = true;
  try {
    await api(`/api/users/${username}`, { method: "DELETE" });
    await loadUsers();
    showToast("Acesso removido com sucesso.", "success");
  } catch (error) {
    removeButton.disabled = false;
    showErrorToast(error);
  }
});

$("#user-password-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api(`/api/users/${state.activeUsername}/password`, {
      method: "PATCH",
      body: JSON.stringify({ password: $("#reset-user-password").value }),
    });
    $("#user-password-dialog").close();
    showToast("Senha redefinida. As sessões anteriores foram encerradas.", "success");
  } catch (error) {
    showErrorToast(error);
  } finally {
    button.disabled = false;
  }
});

$("#close-user-password-dialog").addEventListener("click", () => $("#user-password-dialog").close());
$("#cancel-user-password").addEventListener("click", () => $("#user-password-dialog").close());

$("#close-dialog").addEventListener("click", () => $("#captcha-dialog").close());
$("#refresh-captcha").addEventListener("click", () => startConnection(state.activePortalId));
$("#captcha-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("#captcha-error").hidden = true;
  try {
    const portalId = state.activePortalId;
    const status = await api(`/api/portals/${portalId}/captcha`, {
      method: "POST",
      body: JSON.stringify({
        captcha: state.activeExternalCaptcha ? "confirmado-no-portal" : $("#captcha-input").value,
      }),
    });
    state.activeExternalCaptcha = false;
    $("#captcha-dialog").close();
    renderPortal({ ...state.portals.get(portalId), ...status });
    renderSelectedPortal();
    showToast("Portal conectado com sucesso.", "success");
  } catch (error) {
    $("#captcha-error").textContent = error.message;
    $("#captcha-error").hidden = false;
    if (error.details?.captchaImage) $("#captcha-image").src = error.details.captchaImage;
  } finally {
    button.disabled = false;
  }
});

async function cancelActiveQueryChallenge() {
  const challengeId = state.activeQueryChallengeId;
  state.activeQueryChallengeId = null;
  if ($("#query-captcha-dialog").open) $("#query-captcha-dialog").close();
  $("#loading-result").hidden = true;
  $("#empty-result").hidden = false;
  if (challengeId) {
    await api("/api/margins/query/cancel", {
      method: "POST",
      body: JSON.stringify({ challengeId }),
    }).catch(() => {});
  }
}

$("#close-query-captcha").addEventListener("click", cancelActiveQueryChallenge);
$("#cancel-query-captcha").addEventListener("click", cancelActiveQueryChallenge);
$("#query-captcha-dialog").addEventListener("close", () => {
  if (state.activeQueryChallengeId) cancelActiveQueryChallenge();
});
$("#query-captcha-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  $("#query-captcha-error").hidden = true;
  $("#empty-result").hidden = true;
  $("#loading-result").hidden = false;
  try {
    const result = await api("/api/margins/query/captcha", {
      method: "POST",
      body: JSON.stringify({
        challengeId: state.activeQueryChallengeId,
        captcha: $("#query-captcha-input").value,
      }),
    });
    state.activeQueryChallengeId = null;
    $("#query-captcha-dialog").close();
    renderResult(result);
    showToast("Consulta concluída com sucesso.", "success");
  } catch (error) {
    $("#loading-result").hidden = true;
    $("#empty-result").hidden = false;
    $("#query-captcha-error").textContent = error.message;
    $("#query-captcha-error").hidden = false;
    if (error.details?.captchaImage) {
      $("#query-captcha-image").src = error.details.captchaImage;
      $("#query-captcha-input").value = "";
      $("#query-captcha-input").focus();
    }
    if (error.code === "QUERY_CHALLENGE_INVALID") {
      state.activeQueryChallengeId = null;
      $("#query-captcha-dialog").close();
      showQueryError(error);
    }
  } finally {
    button.disabled = false;
    await loadPortals();
  }
});

async function bootstrap() {
  try {
    const session = await api("/api/session");
    state.portalMode = session.portalMode;
    if (session.authenticated) {
      state.user = session.user;
      showApp();
    } else {
      showLogin();
    }
  } catch {
    showLogin();
  }
}

bootstrap();
