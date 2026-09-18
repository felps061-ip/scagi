import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";

const DAILY_ATTEMPT_LIMIT = 3;

function brazilDay(now) {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(now);
  const values = Object.fromEntries(parts.map(({ type, value }) => [type, value]));
  return `${values.year}-${values.month}-${values.day}`;
}

function readData(filePath) {
  if (!filePath || !existsSync(filePath)) return {};
  try {
    const value = JSON.parse(readFileSync(filePath, "utf8"));
    return value && typeof value === "object" ? value : {};
  } catch {
    return {};
  }
}

export function createPortalAvailabilityStore({ filePath, now = () => new Date() } = {}) {
  let entries = readData(filePath);

  function persist() {
    if (!filePath) return;
    const temporaryPath = `${filePath}.tmp`;
    writeFileSync(temporaryPath, JSON.stringify(entries, null, 2), "utf8");
    renameSync(temporaryPath, filePath);
  }

  function current(portalId) {
    const day = brazilDay(now());
    const entry = entries[portalId];
    if (!entry || entry.day !== day) return { day, attempts: 0, unavailable: false };
    return { day, attempts: Number(entry.attempts) || 0, unavailable: Number(entry.attempts) >= DAILY_ATTEMPT_LIMIT };
  }

  return {
    status(portalId) {
      return current(portalId);
    },

    recordBlockedAttempt(portalId) {
      const entry = current(portalId);
      entries[portalId] = { day: entry.day, attempts: entry.attempts + 1 };
      persist();
      return current(portalId);
    },
  };
}

export { DAILY_ATTEMPT_LIMIT };
