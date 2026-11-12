// Only the service worker writes this bounded, local diagnostic journal.
const KEY = "diagnosticLog";
const LIMIT = 500;
let writes = Promise.resolve();

function safeMessage(error) {
  return String(error?.message ?? error ?? "")
    .replace(/(?:https?|wss?|file|blob|chrome-extension):\/\/[^\s)"'<>]+/gi, "[URL]")
    .replace(/[\r\n\t]+/g, " ")
    .slice(0, 400);
}

export function record(event, details = {}) {
  // Never accept text, page addresses, titles, audio, tokens or arbitrary objects.
  const entry = { at: new Date().toISOString(), event: String(event).replace(/[^a-zA-Z0-9_.-]/g, "").slice(0, 64) };
  for (const key of ["tabId", "session", "index", "chunks", "code", "attempt", "paused"]) {
    if (typeof details[key] === "boolean" || (typeof details[key] === "number" && Number.isFinite(details[key]))) entry[key] = details[key];
  }
  if (details.error) entry.error = safeMessage(details.error);
  const task = writes.then(async () => {
    const stored = await chrome.storage.local.get(KEY);
    const entries = Array.isArray(stored[KEY]) ? stored[KEY] : [];
    await chrome.storage.local.set({ [KEY]: [...entries.slice(-(LIMIT - 1)), entry] });
  });
  // Logging failures must never interrupt reading or create rejection loops.
  writes = task.catch(() => {});
  return writes;
}

export async function exportLog() {
  await writes;
  const stored = await chrome.storage.local.get(KEY);
  const entries = Array.isArray(stored[KEY]) ? stored[KEY] : [];
  return [
    `Read Aloud diagnostics | version ${chrome.runtime.getManifest().version} | ${new Date().toISOString()}`,
    "Local journal, newest 500 events. Times use UTC. No reading text or page addresses.",
    ...entries.map(entry => JSON.stringify(entry)),
    "",
  ].join("\n");
}

export function clearLog() {
  const task = writes.then(() => chrome.storage.local.remove(KEY));
  writes = task.catch(() => {});
  return task;
}
