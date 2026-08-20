const state = {
  user: null,
  portal: null,
  portals: new Map(),
  activePortalId: null,
  portalMode: "mock",
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

function renderSelectedPortal() {
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
  connectButton.hidden = state.user?.role !== "admin";
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
    connectButton.hidden = state.user?.role !== "admin";
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
  $$(".view").forEach((view) => {
    view.hidden = view.id !== `view-${name}`;
  });
  $$(".nav-item[data-view]").forEach((item) => item.classList.toggle("active", item.dataset.view === name));
  const labels = { query: "Consultar margem", integrations: "Integrações", history: "Histórico" };
  $("#breadcrumb-current").textContent = labels[name];
  $(".sidebar").classList.remove("open");
  if (name === "history") loadHistory();
  if (name === "integrations") loadPortals();
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
      body: JSON.stringify({ portal: $("#portal-select").value, cpf: $("#cpf-input").value }),
    });
    renderResult(result);
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
  $("#result-card").hidden = true;
  $("#empty-result").hidden = false;
  $("#cpf-input").focus();
});

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
