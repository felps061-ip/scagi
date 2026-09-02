import test from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createHistoryStore } from "../src/history-store.js";

test("localiza um CPF inteiro sem expor o CPF salvo", () => {
  const directory = mkdtempSync(join(tmpdir(), "scagi-history-"));
  try {
    const store = createHistoryStore({
      filePath: join(directory, "history.json"),
      secret: "segredo-de-teste-com-mais-de-trinta-e-dois-caracteres",
    });
    store.record({ id: "consulta-1", cpf: "***.***.858-49", actor: "vendedor", status: "success", finishedAt: new Date().toISOString() }, "92764785849");
    assert.equal(store.list("92764785849").length, 1);
    assert.equal(store.list("11111111111").length, 0);
    assert.equal(store.list()[0].cpf, "***.***.858-49");
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
