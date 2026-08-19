import { randomUUID } from "node:crypto";
import { maskCpf } from "./cpf.js";
import { SerialQueue } from "./serial-queue.js";
import { PortalError } from "./portals/errors.js";
import { MockPortalDoConsignado } from "./portals/mock-portal.js";
import { PortalDoConsignado } from "./portals/portal-do-consignado.js";

export function createPortalService(config) {
  const integrations = new Map(
    config.portals.map((definition) => [
      definition.id,
      {
        definition,
        portal:
          config.portalMode === "real"
            ? new PortalDoConsignado(definition)
            : new MockPortalDoConsignado(definition),
        queue: new SerialQueue(),
      },
    ]),
  );
  const history = [];

  function getIntegration(portalId) {
    const integration = integrations.get(portalId);
    if (!integration) {
      throw new PortalError("INVALID_PORTAL", "Selecione uma averbadora válida.", 400);
    }
    return integration;
  }

  function record(entry) {
    history.unshift(entry);
    history.splice(25);
  }

  return {
    has(portalId) {
      return integrations.has(portalId);
    },

    list() {
      return [...integrations.values()].map(({ definition, portal, queue }) => ({
        id: definition.id,
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

    query(portalId, cpf, actor) {
      const { definition, portal, queue } = getIntegration(portalId);
      return queue.run(async () => {
        const startedAt = new Date().toISOString();
        try {
          const result = await portal.queryMargin(cpf);
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
      });
    },

    async close() {
      await Promise.all(
        [...integrations.values()].map(({ portal }) => portal.close()),
      );
    },
  };
}
