import assert from "node:assert/strict";

let data = {};
let failWrites = false;
globalThis.chrome = {
  runtime: { getManifest: () => ({ version: "test" }) },
  storage: { local: {
    async get(key) { return structuredClone({ [key]: data[key] }); },
    async set(value) {
      if (failWrites) throw new Error("storage unavailable");
      await new Promise(resolve => setImmediate(resolve));
      Object.assign(data, structuredClone(value));
    },
    async remove(key) { delete data[key]; },
  } },
};
const log = await import("../src/diagnostics.js");
await Promise.all(Array.from({ length: 20 }, (_, index) => log.record("reading.started", { index })));
assert.deepEqual(data.diagnosticLog.map(entry => entry.index), Array.from({ length: 20 }, (_, i) => i));

await log.record("audio.error", { code: 3, error: new Error("Failed https://private.example/path?token=secret\nnext"), text: "private reading", url: "private page", audio: [1, 2] });
const entry = data.diagnosticLog.at(-1);
assert.equal(entry.error, "Failed [URL] next");
assert.equal(entry.code, 3);
assert.equal(entry.text, undefined);
assert.equal(entry.url, undefined);
assert.equal(entry.audio, undefined);
assert.ok(Number.isFinite(Date.parse(entry.at)));

await Promise.all(Array.from({ length: 510 }, (_, index) => log.record("reading.stopped", { index })));
assert.equal(data.diagnosticLog.length, 500);
assert.equal(data.diagnosticLog[0].index, 10);
assert.equal(data.diagnosticLog.at(-1).index, 509);

// A new worker instance must see the existing persistent journal.
const restarted = await import("../src/diagnostics.js?restart");
const exported = await restarted.exportLog();
assert.match(exported, /version test/);
assert.equal(exported.trim().split("\n").length, 502);
assert.equal(JSON.parse(exported.trim().split("\n").at(-1)).index, 509);

await Promise.all([restarted.record("reading.started"), restarted.clearLog(), restarted.record("reading.finished")]);
assert.deepEqual(data.diagnosticLog.map(entry => entry.event), ["reading.finished"]);
failWrites = true;
await restarted.record("audio.error");
failWrites = false;
await restarted.record("reading.resumed");
assert.equal(data.diagnosticLog.at(-1).event, "reading.resumed");
await restarted.clearLog();
assert.equal(data.diagnosticLog, undefined);
assert.equal((await restarted.exportLog()).trim().split("\n").length, 2);
console.log("Diagnostics: concurrent writes, retention, redaction, persistence, export, clear and storage recovery checked.");
