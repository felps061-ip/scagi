const state = {
  user: null,
  portal: null,
  portals: new Map(),
  activePortalId: null,
  activeQueryChallengeId: null,
  activeUsername: null,
  portalMode: "mock",
};

const registrationPortalMetadata = {
  piaui: {
    code: "PI",
    flagClass: "flag-pi",
    transparencyUrl: "https://transparencia.pi.gov.br/servidores",
  },
  pernambuco: {
    code: "PE",
    flagClass: "flag-pe",
    transparencyUrl: "https://transparencia.pe.gov.br/recursos-humanos/remuneracoes/",
  },
};

const $ = (selector, root = document) => root.querySelector(selector);
const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

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

function showToast(message, type = "error") {
  const toast = document.createElement("div");
  toast.className = `toast ${type}`;
  toast.textContent = message;
  $("#toast-region").append(toast);
  setTimeout(() => toast.remove(), 4200);
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
  $("#current-user-role").textContent = state.user?.role === "admin" ? "Administrador" : "Vendedor";
  $("#current-user-avatar").textContent = username.slice(0, 2).toUpperCase();
  $("#users-nav-item").hidden = state.user?.role !== "admin";
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
  const metadata = registrationPortalMetadata[$("#portal-select").value];
  const requiresRegistration = Boolean(metadata);
  const registrationField = $("#registration-field");
  const registrationInput = $("#registration-input");
  registrationField.hidden = !requiresRegistration;
  registrationInput.required = requiresRegistration;
  $(".query-grid").classList.toggle("with-registration", requiresRegistration);
  const flag = $("#portal-flag");
  flag.textContent = metadata?.code || "SP";
  flag.className = `government-flag ${metadata?.flagClass || "flag-sp"}`;
  if (metadata) $("#registration-help-link").href = metadata.transparencyUrl;
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
  connectButton.textContent = connected.length === connections.length && connectionToOpen.mode === "real"
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
    connectButton.textContent = portal.state === "connected" && portal.mode === "real"
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
    showToast(error.message);
  }
}

function switchView(name) {
  if (name === "users" && state.user?.role !== "admin") name = "query";
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
  const employment = result.employments[0];
  $("#result-name").textContent = employment.name;
  $("#result-meta").textContent = `${employment.agency} · Identificação ${employment.registration} · Próxima folha ${employment.nextPayrollProcessing}`;
  $("#result-cpf").textContent = result.cpf;
  $("#result-provision").textContent = employment.provision;
  $("#result-reference").textContent = `Referência ${employment.referenceMonth}`;
  $("#result-time").textContent = `Consultado em ${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(result.queriedAt))}`;
  $("#margin-grid").innerHTML = employment.margins
    .map((margin) => `<div class="margin-item"><span>${escapeHtml(margin.product)}</span><strong>${escapeHtml(margin.value)}</strong></div>`)
    .join("");
  $("#empty-result").hidden = true;
  $("#loading-result").hidden = true;
  $("#result-card").hidden = false;
}

async function loadHistory() {
  try {
    const { history } = await api("/api/history");
    $("#history-body").innerHTML = history.length
      ? history.map((item) => `<tr>
          <td>${escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(item.startedAt)))}</td>
          <td>${escapeHtml(item.portal)}</td><td>${escapeHtml(item.cpf)}</td><td>${escapeHtml(item.actor)}</td>
          <td><span class="history-status ${item.status}">${item.status === "success" ? "Sucesso" : "Falha"}</span></td>
        </tr>`).join("")
      : '<tr><td colspan="5" class="empty-table">Nenhuma consulta realizada.</td></tr>';
  } catch (error) {
    showToast(error.message);
  }
}

async function loadUsers() {
  try {
    const { users } = await api("/api/users");
    $("#users-body").innerHTML = users.map((user) => `<tr>
      <td><strong>${escapeHtml(user.username)}</strong></td>
      <td><span class="user-role">${user.role === "admin" ? "Administrador" : "Vendedor"}</span></td>
      <td>${escapeHtml(new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(user.createdAt)))}</td>
      <td><div class="user-actions">
        <button class="button button-secondary" data-reset-user="${user.username}" type="button">Redefinir senha</button>
        ${user.role === "admin" ? "" : `<button class="button button-danger" data-remove-user="${user.username}" type="button">Remover</button>`}
      </div></td>
    </tr>`).join("");
  } catch (error) {
    showToast(error.message);
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
    if (status.captchaImage) {
      $("#captcha-portal-name").textContent = (portal?.name || "Portal do Consignado").toUpperCase();
      $("#captcha-image").src = status.captchaImage;
      $("#captcha-input").value = "";
      $("#captcha-error").hidden = true;
      if (!$("#captcha-dialog").open) $("#captcha-dialog").showModal();
    } else {
      renderPortal({ ...portal, ...status });
      renderSelectedPortal();
      showToast("Portal pronto para consultas.", "success");
    }
  } catch (error) {
    showToast(error.message);
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
  $("#loading-result").hidden = false;
  try {
    const result = await api("/api/margins/query", {
      method: "POST",
      body: JSON.stringify({
        portal: $("#portal-select").value,
        cpf: $("#cpf-input").value,
        registration: $("#registration-input").value,
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
    $("#loading-result").hidden = true;
    $("#empty-result").hidden = false;
    showToast(error.message);
    if (["PORTAL_NOT_CONNECTED", "PORTAL_SESSION_EXPIRED"].includes(error.code)) switchView("integrations");
  } finally {
    await loadPortals();
  }
});

$("#new-query-button").addEventListener("click", () => {
  $("#cpf-input").value = "";
  $("#registration-input").value = "";
  $("#result-card").hidden = true;
  $("#empty-result").hidden = false;
  $("#cpf-input").focus();
});

$("#create-user-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.submitter;
  button.disabled = true;
  try {
    await api("/api/users", {
      method: "POST",
      body: JSON.stringify({
        username: $("#new-user-username").value,
        password: $("#new-user-password").value,
      }),
    });
    event.currentTarget.reset();
    await loadUsers();
    showToast("Vendedor criado com sucesso.", "success");
  } catch (error) {
    showToast(error.message);
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
    showToast(error.message);
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
    showToast(error.message);
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
      body: JSON.stringify({ captcha: $("#captcha-input").value }),
    });
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
      showToast(error.message);
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
