import { randomUUID } from "node:crypto";
import { maskCpf } from "./cpf.js";
import { SerialQueue } from "./serial-queue.js";
import { PortalError } from "./portals/errors.js";
import { ConsigfacilPiaui } from "./portals/consigfacil-piaui.js";
import { MockPortalDoConsignado } from "./portals/mock-portal.js";
import { PortalDoConsignado } from "./portals/portal-do-consignado.js";
import { RondoniaPortal } from "./portals/rondonia.js";
import { RoraimaPortal } from "./portals/roraima.js";

const QUERY_CHALLENGE_TTL = 10 * 60 * 1000;

export function createPortalService(config, dependencies = {}) {
  const createPortal = dependencies.createPortal || ((definition) => {
    if (config.portalMode !== "real") return new MockPortalDoConsignado(definition);
    if (definition.adapter === "consigfacil") return new ConsigfacilPiaui(definition);
    if (definition.adapter === "rondonia") return new RondoniaPortal(definition);
    if (definition.adapter === "roraima") return new RoraimaPortal(definition);
    return new PortalDoConsignado(definition);
  });
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
  const queryChallenges = new Map();

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

  function clearChallenge(challengeId) {
    const challenge = queryChallenges.get(challengeId);
    if (!challenge) return;
    queryChallenges.delete(challengeId);
    challenge.portal.cancelPendingQuery?.();
  }

  function sweepExpiredChallenges() {
    const cutoff = Date.now() - QUERY_CHALLENGE_TTL;
    for (const [challengeId, challenge] of queryChallenges) {
      if (challenge.createdAt < cutoff) clearChallenge(challengeId);
    }
  }

  function activeChallengeFor(integrationId) {
    sweepExpiredChallenges();
    return [...queryChallenges.entries()].find(
      ([, challenge]) => challenge.integrationId === integrationId,
    );
  }

  return {
    has(queryPortalId) {
      return [...integrations.values()].some(
        ({ definition }) => definition.queryPortalId === queryPortalId,
      );
    },

    requirements(queryPortalId) {
      const definitions = getQueryIntegrations(queryPortalId).map(({ definition }) => definition);
      return {
        fields: [...new Set(definitions.flatMap(({ queryFields = [] }) => queryFields))],
      };
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
      const activeChallenge = activeChallengeFor(portalId);
      if (activeChallenge) clearChallenge(activeChallenge[0]);
      return queue.run(() => portal.prepareLogin());
    },

    submitCaptcha(portalId, captcha) {
      const { portal, queue } = getIntegration(portalId);
      return queue.run(() => portal.submitCaptcha(captcha));
    },

    query(queryPortalId, cpf, actor, parameters = {}) {
      const candidates = selectQueryIntegrations(queryPortalId);
      const startedAt = new Date().toISOString();
      return (async () => {
        let lastSessionError;
        for (const { definition, portal, queue } of candidates) {
          try {
            const activeChallenge = activeChallengeFor(definition.id);
            if (activeChallenge) {
              if (activeChallenge[1].actor !== actor) {
                throw new PortalError(
                  "PORTAL_BUSY",
                  "Este acesso está aguardando o CAPTCHA de outra consulta. Tente novamente em alguns minutos.",
                  409,
                );
              }
              clearChallenge(activeChallenge[0]);
            }

            const result = await queue.run(() => portal.queryMargin(cpf, parameters));
            if (result?.requiresCaptcha && result.challengeType === "query_captcha") {
              const challengeId = randomUUID();
              queryChallenges.set(challengeId, {
                integrationId: definition.id,
                portalName: definition.name,
                portal,
                queue,
                cpf,
                actor,
                startedAt,
                createdAt: Date.now(),
              });
              return { ...result, challengeId };
            }
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

    submitQueryCaptcha(challengeId, captcha, actor) {
      sweepExpiredChallenges();
      const challenge = queryChallenges.get(String(challengeId || ""));
      if (!challenge || challenge.actor !== actor) {
        throw new PortalError(
          "QUERY_CHALLENGE_INVALID",
          "Esta confirmação de consulta expirou. Inicie a pesquisa novamente.",
          409,
        );
      }

      return challenge.queue.run(async () => {
        try {
          const result = await challenge.portal.submitQueryCaptcha(captcha);
          queryChallenges.delete(challengeId);
          record({
            id: randomUUID(),
            portal: challenge.portalName,
            cpf: maskCpf(challenge.cpf),
            actor,
            status: "success",
            startedAt: challenge.startedAt,
            finishedAt: new Date().toISOString(),
          });
          return result;
        } catch (error) {
          if (error.code === "CAPTCHA_REJECTED") throw error;
          clearChallenge(challengeId);
          record({
            id: randomUUID(),
            portal: challenge.portalName,
            cpf: maskCpf(challenge.cpf),
            actor,
            status: "error",
            message: error.message,
            startedAt: challenge.startedAt,
            finishedAt: new Date().toISOString(),
          });
          throw error;
        }
      });
    },

    cancelQueryCaptcha(challengeId, actor) {
      sweepExpiredChallenges();
      const challenge = queryChallenges.get(String(challengeId || ""));
      if (challenge?.actor === actor) clearChallenge(challengeId);
      return { cancelled: Boolean(challenge?.actor === actor) };
    },

    async close() {
      for (const challengeId of queryChallenges.keys()) clearChallenge(challengeId);
      await Promise.all(
        [...integrations.values()].map(({ portal }) => portal.close()),
      );
    },
  };
}
