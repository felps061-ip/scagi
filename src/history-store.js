import { createHmac } from "node:crypto";
import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

const RETENTION_MS = 24 * 60 * 60 * 1000;

function dayInBrazil(date = new Date()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(date);
}

function createFingerprint(secret, cpf) {
  return createHmac("sha256", secret).update(String(cpf)).digest("base64url");
}

export function createHistoryStore({ filePath, secret }) {
  let entries = [];
  try {
    const loaded = JSON.parse(readFileSync(filePath, "utf8"));
    entries = Array.isArray(loaded) ? loaded : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
  }

  function purge() {
    const cutoff = Date.now() - RETENTION_MS;
    entries = entries.filter((entry) => Date.parse(entry.finishedAt || entry.startedAt) >= cutoff);
  }

  function persist() {
    mkdirSync(dirname(filePath), { recursive: true });
    writeFileSync(filePath, `${JSON.stringify(entries, null, 2)}\n`, { encoding: "utf8", mode: 0o600 });
  }

  purge();
  persist();

  return {
    list(cpf = "") {
      purge();
      persist();
      const digits = String(cpf).replace(/\D/g, "");
      const matchingFingerprint = digits.length === 11 ? createFingerprint(secret, digits) : null;
      return entries
        .filter((entry) => !matchingFingerprint || entry.cpfFingerprint === matchingFingerprint)
        .map(({ cpfFingerprint, queryDay, ...entry }) => entry);
    },
    wasQueriedToday(actor, cpf) {
      purge();
      const fingerprint = createFingerprint(secret, cpf);
      const today = dayInBrazil();
      return entries.some((entry) => (
        entry.actor === actor
        && entry.status === "success"
        && entry.queryDay === today
        && entry.cpfFingerprint === fingerprint
      ));
    },
    record(entry, cpf) {
      purge();
      entries.unshift({
        ...entry,
        queryDay: dayInBrazil(),
        cpfFingerprint: createFingerprint(secret, cpf),
      });
      persist();
    },
  };
}
