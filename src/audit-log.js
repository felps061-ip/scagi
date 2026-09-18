import { appendFileSync, existsSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { mkdirSync } from "node:fs";

const MAX_LOG_SIZE = 5 * 1024 * 1024;

export function createAuditLog(filePath) {
  function rotateIfNeeded() {
    if (!existsSync(filePath) || statSync(filePath).size < MAX_LOG_SIZE) return;
    renameSync(filePath, `${filePath}.1`);
  }

  return {
    write(event, fields = {}) {
      try {
        mkdirSync(dirname(filePath), { recursive: true });
        rotateIfNeeded();
        appendFileSync(filePath, `${JSON.stringify({ at: new Date().toISOString(), event, ...fields })}\n`, {
          encoding: "utf8",
          mode: 0o600,
        });
      } catch (error) {
        console.error("Não foi possível registrar auditoria:", error.message);
      }
    },
  };
}
