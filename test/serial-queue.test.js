import test from "node:test";
import assert from "node:assert/strict";
import { SerialQueue } from "../src/serial-queue.js";

test("serializa operações concorrentes e se recupera de falhas", async () => {
  const queue = new SerialQueue();
  const events = [];

  const first = queue.run(async () => {
    events.push("first:start");
    await new Promise((resolve) => setTimeout(resolve, 25));
    events.push("first:end");
    throw new Error("falha esperada");
  });
  const second = queue.run(async () => {
    events.push("second:start");
    events.push("second:end");
    return 42;
  });

  await assert.rejects(first, /falha esperada/);
  assert.equal(await second, 42);
  assert.deepEqual(events, ["first:start", "first:end", "second:start", "second:end"]);
  assert.equal(queue.pending, 0);
});
