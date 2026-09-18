import assert from "node:assert/strict";
import test from "node:test";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { createPortalAvailabilityStore } from "../src/portal-availability-store.js";

test("marca o portal indisponível após três bloqueios no mesmo dia", () => {
  const directory = mkdtempSync(join(tmpdir(), "scagi-availability-"));
  try {
    const store = createPortalAvailabilityStore({
      filePath: join(directory, "availability.json"),
      now: () => new Date("2026-09-16T15:00:00.000Z"),
    });
    assert.equal(store.status("maranhao-primary").unavailable, false);
    store.recordBlockedAttempt("maranhao-primary");
    store.recordBlockedAttempt("maranhao-primary");
    assert.deepEqual(store.status("maranhao-primary"), { day: "2026-09-16", attempts: 2, unavailable: false });
    store.recordBlockedAttempt("maranhao-primary");
    assert.deepEqual(store.status("maranhao-primary"), { day: "2026-09-16", attempts: 3, unavailable: true });
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
