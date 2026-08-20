import { randomUUID } from "node:crypto";
import { maskCpf } from "./cpf.js";
import { SerialQueue } from "./serial-queue.js";
import { PortalError } from "./portals/errors.js";
import { MockPortalDoConsignado } from "./portals/mock-portal.js";
import { PortalDoConsignado } from "./portals/portal-do-consignado.js";

export function createPortalService(config, dependencies = {}) {
  const createPortal = dependencies.createPortal || ((definition) => (
    config.portalMode === "real"
      ? new PortalDoConsignado(definition)
      : new MockPortalDoConsignado(definition)
  ));
  const integrations = new Map(
    config.portals.map((definition) => [
      definition.id,
      {
        definition,
        portal: createPortal(definition),
        queue: new SerialQueue(),
      },
    ]),
  );
  const history = [];
  const roundRobinCursor = new Map();

  function getIntegration(portalId) {
    const integration = integrations.get(portalId);
    if (!integration) {
      throw new PortalError("INVALID_PORTAL", "Selecione uma averbadora válida.", 400);
    }
    return integration;
  }

  function getQueryIntegrations(queryPortalId) {
    const candidates = [...integrations.values()].filter(
      ({ definition }) => definition.queryPortalId === queryPortalId,
    );
    if (!candidates.length) {
      throw new PortalError("INVALID_PORTAL", "Selecione uma averbadora válida.", 400);
    }
    return candidates;
  }

  function selectQueryIntegrations(queryPortalId) {
    const connected = getQueryIntegrations(queryPortalId).filter(
      ({ portal }) => portal.status().state === "connected",
    );
    if (!connected.length) {
      throw new PortalError(
        "PORTAL_NOT_CONNECTED",
        "Conecte pelo menos um acesso desta averbadora antes de consultar.",
        409,
      );
    }

    const cursor = roundRobinCursor.get(queryPortalId) || 0;
    const start = cursor % connected.length;
    roundRobinCursor.set(queryPortalId, cursor + 1);
    return [...connected.slice(start), ...connected.slice(0, start)];
  }

  function record(entry) {
    history.unshift(entry);
    history.splice(25);
  }

  return {
    has(queryPortalId) {
      return [...integrations.values()].some(
        ({ definition }) => definition.queryPortalId === queryPortalId,
      );
    },

    list() {
      return [...integrations.values()].map(({ definition, portal, queue }) => ({
        id: definition.id,
        queryPortalId: definition.queryPortalId,
        name: definition.name,
        governments: definition.governments,
        queueLength: queue.pending,
        ...portal.status(),
      }));
    },

    history() {
      return history;
    },

    prepareLogin(portalId) {
      const { portal, queue } = getIntegration(portalId);
      return queue.run(() => portal.prepareLogin());
    },

    submitCaptcha(portalId, captcha) {
      const { portal, queue } = getIntegration(portalId);
      return queue.run(() => portal.submitCaptcha(captcha));
    },

    query(queryPortalId, cpf, actor) {
      const candidates = selectQueryIntegrations(queryPortalId);
      const startedAt = new Date().toISOString();
      return (async () => {
        let lastSessionError;
        for (const { definition, portal, queue } of candidates) {
          try {
            const result = await queue.run(() => portal.queryMargin(cpf));
            record({
              id: randomUUID(),
              portal: definition.name,
              cpf: maskCpf(cpf),
              actor,
              status: "success",
              startedAt,
              finishedAt: new Date().toISOString(),
            });
            return result;
          } catch (error) {
            if (["PORTAL_SESSION_EXPIRED", "PORTAL_NOT_CONNECTED"].includes(error.code)) {
              lastSessionError = error;
              continue;
            }

            record({
              id: randomUUID(),
              portal: definition.name,
              cpf: maskCpf(cpf),
              actor,
              status: "error",
              message: error.message,
              startedAt,
              finishedAt: new Date().toISOString(),
            });
            throw error;
          }
        }

        const error = lastSessionError || new PortalError(
          "PORTAL_NOT_CONNECTED",
          "Nenhum acesso conectado permaneceu disponível para a consulta.",
          409,
        );
        record({
          id: randomUUID(),
          portal: candidates.map(({ definition }) => definition.name).join(" / "),
          cpf: maskCpf(cpf),
          actor,
          status: "error",
          message: error.message,
          startedAt,
          finishedAt: new Date().toISOString(),
        });
        throw error;
      })();
    },

    async close() {
      await Promise.all(
        [...integrations.values()].map(({ portal }) => portal.close()),
      );
    },
  };
}
