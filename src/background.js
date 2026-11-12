import { record, exportLog, clearLog } from "./diagnostics.js";
import "./locales/base.js";
import "./i18n.js";
import "./library.js";
import "./settings.js";
import "./vault.js";
import "./tools.js";
import "./insights.js";
const library = globalThis.SesliOkuLibrary;
const i18n = globalThis.SesliOkuI18n;
const t = (key, params) => (i18n ? i18n.t(key, params) : key);
import { tts, listVoices } from "./tts.js";

const VOICES_TTL_MS = 7 * 24 * 60 * 60 * 1000;

let readingTabId = null;
record("worker.started");
globalThis.addEventListener?.("error", event => { record("worker.error", { error: event.error || event.message }); });
globalThis.addEventListener?.("unhandledrejection", event => { record("worker.rejection", { error: event.reason }); });

/**
 * chrome.runtime messaging serializes payloads as JSON, so a Uint8Array would
 * arrive as a plain object. Base64 keeps audio transfer cheap enough.
 */
function toBase64(bytes) {
  let binary = "";
  const chunkSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += chunkSize) {
    binary += String.fromCharCode.apply(
      null,
      bytes.subarray(offset, offset + chunkSize)
    );
  }
  return btoa(binary);
}

const FALLBACK_VOICES = [
  {
    Name: "Microsoft Server Speech Text to Speech Voice (tr-TR, EmelNeural)",
    ShortName: "tr-TR-EmelNeural",
    Gender: "Female",
    Locale: "tr-TR",
    FriendlyName: "Microsoft Emel Online (Natural) - Turkish (Turkey)",
  },
  {
    Name: "Microsoft Server Speech Text to Speech Voice (tr-TR, AhmetNeural)",
    ShortName: "tr-TR-AhmetNeural",
    Gender: "Male",
    Locale: "tr-TR",
    FriendlyName: "Microsoft Ahmet Online (Natural) - Turkish (Türkiye)",
  },
  {
    Name: "Microsoft Server Speech Text to Speech Voice (en-US, AvaNeural)",
    ShortName: "en-US-AvaNeural",
    Gender: "Female",
    Locale: "en-US",
    FriendlyName: "Microsoft Ava Online (Natural) - English (United States)",
  },
  {
    Name: "Microsoft Server Speech Text to Speech Voice (en-GB, RyanNeural)",
    ShortName: "en-GB-RyanNeural",
    Gender: "Male",
    Locale: "en-GB",
    FriendlyName: "Microsoft Ryan Online (Natural) - English (United Kingdom)",
  },
];

async function getSettings() {
  const { settings } = await chrome.storage.local.get("settings");
  return globalThis.SesliOkuSettings.normalize(settings);
}

async function getVoices() {
  const { voicesCache } = await chrome.storage.local.get("voicesCache");
  if (voicesCache?.voices?.length && Date.now() - voicesCache.at < VOICES_TTL_MS) {
    return { voices: voicesCache.voices, cached: true };
  }
  try {
    const voices = await listVoices();
    await chrome.storage.local.set({ voicesCache: { at: Date.now(), voices } });
    return { voices, cached: false };
  } catch (error) {
    if (voicesCache?.voices?.length) {
      return { voices: voicesCache.voices, cached: true, warning: error.message };
    }
    return { voices: FALLBACK_VOICES, cached: false, warning: error.message };
  }
}

async function activeTab() {
  let [tab] = await chrome.tabs.query({
    active: true,
    lastFocusedWindow: true,
  });
  if (!tab) {
    [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  }
  return tab;
}

async function pingContent(tabId) {
  try {
    const response = await chrome.tabs.sendMessage(
      tabId,
      { target: "content", type: "PING" },
      { frameId: 0 }
    );
    return response?.ok === true;
  } catch {
    return false;
  }
}

async function ensureContent(tabId) {
  if (await pingContent(tabId)) return true;
  try {
    await chrome.scripting.insertCSS({
      target: { tabId },
      files: ["src/content.css"],
    });
    await chrome.scripting.executeScript({
      target: { tabId },
      files: ["src/themes.js", "src/library.js", "src/settings.js", "src/tools.js", "src/vendor/audio/codecs.js", "src/audio-export.js", "src/experience.js", "src/content.js"],
    });
  } catch {
    return false;
  }
  // Give the freshly injected script a moment to register its listener.
  for (let attempt = 0; attempt < 5; attempt++) {
    if (await pingContent(tabId)) return true;
    await new Promise((resolve) => setTimeout(resolve, 80));
  }
  return false;
}

async function sendToTab(tabId, message) {
  if (!(await ensureContent(tabId))) {
    throw new Error(t("errors.unsupportedPage"));
  }
  const response = await chrome.tabs.sendMessage(tabId, message, { frameId: 0 });
  if (response && response.ok === false) {
    throw new Error(response.error || t("errors.generic"));
  }
  return response;
}

async function startOnActiveTab(kind, extra = {}) {
  const tab = await activeTab();
  if (!tab?.id) throw new Error(t("errors.noActiveTab"));
  await library.ready;
  const queueOwner = library.current().queueTabId;
  if (library.current().queueRunning) {
    await library.mutate({ type: "queueStop" }); await chrome.alarms.clear(QUEUE_ALARM);
    if (queueOwner && queueOwner !== tab.id) { try { await sendToTab(queueOwner, { target: "content", type: "STOP", keepQueue: true }); } catch {} }
  }
  const settings = await getSettings();
  readingTabId = tab.id;
  return sendToTab(tab.id, {
    target: "content",
    type: kind,
    settings,
    ...extra,
  });
}

let menusCreated = false;

function createMenus() {
  menusCreated = true;
  chrome.contextMenus.removeAll(() => {
    chrome.contextMenus.create({
      id: "edge-ra-read-page",
      title: t("background.menu.readPage"),
      contexts: ["page"],
    });
    chrome.contextMenus.create({
      id: "edge-ra-read-selection",
      title: t("background.menu.readSelection"),
      contexts: ["selection"],
    });
    chrome.contextMenus.create({
      id: "edge-ra-read-here",
      title: t("background.menu.readHere"),
      contexts: ["page", "selection"],
    });
    chrome.contextMenus.create({
      id: "edge-ra-stop",
      title: t("background.menu.stop"),
      contexts: ["page", "selection"],
    });
  });
}

i18n?.subscribe(() => {
  if (menusCreated) createMenus();
});
// Rebuild once when the stored locale is known, including service-worker wakes
// where onStartup/onInstalled did not run in this lifetime.
i18n?.ready.then(() => createMenus());

function initializeExtension() {
  createMenus();
  // Sleep timers belong to live playback sessions, not browser restarts.
  chrome.storage.local.remove("readingTimer").catch(() => {});
  library.mutate({ type: "queueStop" }).catch(() => {});
  library.mutate({ type: "export", value: null }).catch(() => {});
  globalThis.SesliOkuVault.list().then(books=>Promise.all(books.filter(book=>book.status==='working').map(book=>globalThis.SesliOkuVault.remove(book.id)))).catch(()=>{});
}
chrome.runtime.onInstalled.addListener(initializeExtension);
chrome.runtime.onStartup.addListener(initializeExtension);

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId === "edge-ra-read-page" && tab?.id) {
    try {
      readingTabId = tab.id;
      await sendToTab(tab.id, {
        target: "content",
        type: "START_PAGE",
        settings: await getSettings(),
      });
    } catch (error) {
      console.warn("[Read Aloud]", error);
    }
  } else if (info.menuItemId === "edge-ra-read-selection" && tab?.id) {
    try {
      readingTabId = tab.id;
      await sendToTab(tab.id, {
        target: "content",
        type: "START_SELECTION",
        settings: await getSettings(),
        text: info.selectionText || "",
      });
    } catch (error) {
      console.warn("[Read Aloud]", error);
    }
  } else if (info.menuItemId === "edge-ra-read-here" && tab?.id) {
    try {
      readingTabId = tab.id;
      await sendToTab(tab.id, {
        target: "content",
        type: "START_FROM_CURSOR",
        fromPoint: true,
        settings: await getSettings(),
      });
    } catch (error) {
      console.warn("[Read Aloud]", error);
    }
  } else if (info.menuItemId === "edge-ra-stop" && tab?.id) {
    try {
      await sendToTab(tab.id, { target: "content", type: "STOP" });
      tts.close();
    } catch (error) {
      console.warn("[Read Aloud]", error);
    }
  }
});

chrome.commands.onCommand.addListener(async (command) => {
  try {
    if (command === "read-page") {
      await startOnActiveTab("START_PAGE");
    } else if (command === "read-selection") {
      await startOnActiveTab("START_SELECTION");
    } else if (command === "read-here") {
      await startOnActiveTab("START_FROM_CURSOR");
    } else if (command === "toggle") {
      await startOnActiveTab("TOGGLE");
    } else if (command === "stop") {
      await startOnActiveTab("STOP");
      tts.close();
    }
  } catch (error) {
    console.warn("[Read Aloud]", error);
  }
});

chrome.tabs.onRemoved.addListener((tabId) => {
  if (tabId === readingTabId) record("reading.tab_closed", { tabId });
  if (tabId === readingTabId) {
    readingTabId = null;
    tts.close();
    chrome.storage.local.remove("readingTimer").catch(() => {});
  }
  if (library.current().queueTabId === tabId) library.mutate({ type: "queueStop" }).catch(() => {});
  if (library.current().export?.tabId === tabId) {const id=library.current().export.bookId;if(id)globalThis.SesliOkuVault.remove(id).catch(()=>{});library.mutate({ type: "export", value: { status: "canceled" } }).catch(() => {});}
  globalThis.SesliOkuVault.list().then(books=>Promise.all(books.filter(book=>book.status==='working'&&book.ownerTabId===tabId).map(book=>globalThis.SesliOkuVault.remove(book.id)))).catch(()=>{});
  queueStarted.delete(tabId);
});

const QUEUE_ALARM = "sesli-oku-queue-load";
let queueBusy = false;
const queueStarted = new Map();

async function advanceQueue() {
  if (queueBusy) return;
  queueBusy = true;
  try {
    await library.ready;
    let value = library.current();
    if (!value.queueRunning) return;
    const next = value.queue.find(item => item.status === "pending");
    if (!next) { await library.mutate({ type: "queueStop" }); await chrome.alarms.clear(QUEUE_ALARM); return; }
    let tab = null;
    if (value.queueTabId) {
      try { tab = await chrome.tabs.get(value.queueTabId); } catch {}
    }
    queueStarted.delete(value.queueTabId);
    // Record the item before navigation, so content-ready messages can be
    // matched to the current URL rather than a previous document in the tab.
    await library.mutate({ type: "queueState", id: next.id, status: "loading", itemId: next.id, tabId: null });
    tab = tab ? await chrome.tabs.update(tab.id, { url: next.url, active: true }) : await chrome.tabs.create({ url: next.url, active: true });
    await library.mutate({ type: "queueState", tabId: tab.id });
    chrome.alarms.create(QUEUE_ALARM, { when: Date.now() + 60000 });
    const current = await chrome.tabs.get(tab.id);
    if (current.status === "complete") setTimeout(() => startQueuePage(tab.id), 0);
  } finally { queueBusy = false; }
}

async function startQueuePage(tabId) {
  await library.ready;
  const value = library.current(); const item = value.queue.find(entry => entry.id === value.queueItemId);
  if (!value.queueRunning || value.queueTabId !== tabId || !item || item.status !== "loading" || queueStarted.get(tabId) === item.id) return;
  queueStarted.set(tabId, item.id);
  try {
    const tab = await chrome.tabs.get(tabId);
    if (tab.status !== "complete") { queueStarted.delete(tabId); return; }
    const settings = await getSettings();
    if (!library.current().queueRunning || library.current().queueItemId !== item.id) return;
    readingTabId = tabId;
    const result = await sendToTab(tabId, { target: "content", type: "START_PAGE", settings, queueItemId: item.id });
    if (!library.current().queueRunning || library.current().queueItemId !== item.id) return;
    if (result?.started === false) throw new Error(t("errors.pageNoText"));
    await library.mutate({ type: "queueState", id: item.id, status: "reading" });
    await chrome.alarms.clear(QUEUE_ALARM);
  } catch (error) {
    await library.mutate({ type: "queueState", id: item.id, status: "error", error: error.message });
    queueStarted.delete(tabId); await advanceQueue();
  }
}

chrome.tabs.onUpdated.addListener((tabId, info) => {
  if (info.status === "complete") startQueuePage(tabId).catch(error => console.warn("[Read Aloud]", error));
});
chrome.alarms.onAlarm.addListener(alarm => {
  if (alarm.name !== QUEUE_ALARM) return;
  library.ready.then(async () => {
    const value = library.current();
    if (!value.queueRunning || !value.queueItemId) return;
    const item = value.queue.find(entry => entry.id === value.queueItemId);
    if (item?.status !== "loading") return;
    await library.mutate({ type: "queueState", id: item.id, status: "error", error: t("errors.pageTimeout") });
    queueStarted.delete(value.queueTabId); await advanceQueue();
  }).catch(error => console.warn("[Read Aloud]", error));
});

async function senderTabId(sender) {
  if(sender?.tab?.id)return sender.tab.id;
  if(sender?.url?.startsWith(chrome.runtime.getURL('src/reader.html'))){const tabs=await chrome.tabs.query({});return tabs.find(tab=>tab.url===sender.url)?.id;}
  return undefined;
}
async function libraryAction(message, sender) {
  const { action, args = {} } = message;
  const tab = sender?.tab?.id ? sender.tab : await activeTab();
  const context = { url: sender?.tab?.id ? sender.url || tab?.url : tab?.url, title: tab?.title || t("common.page") };
  if (action === "context") {
    if(context.url?.startsWith(chrome.runtime.getURL('src/reader.html'))){const id=new URL(context.url).searchParams.get('book');if(id){const book=await globalThis.SesliOkuVault.get(id);if(book?.kind==='audio')context.speech=book.settings;}}
    return { context };
  }
  if (action === 'stats') return {stats:await SesliOkuInsights.stats(args)};
  if (action === 'syncNow') return SesliOkuInsights.synchronize();
  if (action === 'syncEnable') return SesliOkuInsights.configure(args.enabled);
  if (action === 'syncClear') return SesliOkuInsights.clearRemote();
  if (action === 'backup') return {backup:await globalThis.SesliOkuTools.backup(),message:t('background.backupDownloading')};
  if (action === 'restore') { const owner=library.current().queueTabId;const parsed=globalThis.SesliOkuTools.validateBackup(args.backup);if(!parsed)throw new Error(t("errors.invalidBackup"));if(owner){try{await sendToTab(owner,{target:'content',type:'STOP'});}catch{}}return globalThis.SesliOkuTools.restore(args.backup); }
  if (action === 'siteSave') { await library.mutate({type:action,...args});return {message:t('background.siteSaved')}; }
  if (action === 'siteRemove' || action === 'itemEdit') { await library.mutate({type:action,...args});return {message:t('background.libraryUpdated')}; }
  if (action === 'vaultList') return {books:await globalThis.SesliOkuVault.list()};
  if (action === 'bookRemove') {await globalThis.SesliOkuVault.remove(args.id);return {message:t('background.vaultRemoved')};}
  if (action === 'openReader' || action === 'bookOpen') {await chrome.tabs.create({url:chrome.runtime.getURL('src/reader.html')+(args.id?'?book='+encodeURIComponent(args.id):''),active:true});return {message:t('background.readerOpened')};}
  if (action === "queueAddUrl") { await library.mutate({ type: "queueAdd", url: args.url, title: args.title }); return { message: t("background.queueAdded") }; }
  if (action === "queueStart") {
    if (library.current().queueRunning) return { message: t("background.queueRunning") };
    await library.mutate({ type: "queueStart" }); await advanceQueue(); return { message: t("background.queueStarted") };
  }
  if (action === "queueStop") {
    const owner = library.current().queueTabId;
    await library.mutate({ type: "queueStop" }); await chrome.alarms.clear(QUEUE_ALARM);
    if (owner) { try { await sendToTab(owner, { target: "content", type: "STOP" }); } catch {} }
    return { message: t("background.queueStopped") };
  }
  if (["queueMove", "queueRemove", "bookmarkRemove", "excludeRemove"].includes(action)) {
    const old = library.current();
    await library.mutate({ type: action, ...args });
    if (action === "queueRemove" && old.queueItemId === args.id && old.queueRunning) {
      if (old.queueTabId) { try { await sendToTab(old.queueTabId, { target: "content", type: "STOP", keepQueue: true }); } catch {} }
      await advanceQueue();
    }
    return { message: t("background.libraryUpdated") };
  }
  if (action === "bookmarkOpen") {
    const item = library.current().bookmarks.find(entry => entry.id === args.id);
    if (!item) throw new Error(t("errors.bookmarkMissing"));
    if (context.url && library.pageKey(context.url) === library.pageKey(item.url) && tab?.id) return sendToTab(tab.id, { target: "content", type: "LIBRARY_ACTION", action: "resume", args: { anchor: item.anchor } });
    const created = await chrome.tabs.create({ url: item.url, active: true });
    await chrome.storage.session.set({ [`resume-${created.id}`]: item.anchor });
    const opened = await chrome.tabs.get(created.id);
    if (opened.status === "complete") { await chrome.storage.session.remove(`resume-${created.id}`); await sendToTab(created.id, { target: "content", type: "LIBRARY_ACTION", action: "resume", args: { anchor: item.anchor } }); }
    return { message: t("background.bookmarkOpening") };
  }
  if (action === "cancelExport" && library.current().export?.tabId) return sendToTab(library.current().export.tabId, { target: "content", type: "LIBRARY_ACTION", action, args });
  if (!tab?.id) throw new Error(t("errors.noActivePage"));
  return sendToTab(tab.id, { target: "content", type: "LIBRARY_ACTION", action, args });
}

const localeCache = new Map();

async function localeMessages(code) {
  if (localeCache.has(code)) return localeCache.get(code);
  const response = await fetch(chrome.runtime.getURL(`locales/${code}/translation.json`), { cache: "no-store" });
  if (!response.ok) throw new Error(`Locale ${code} could not be loaded.`);
  const messages = await response.json();
  localeCache.set(code, messages);
  return messages;
}

async function handleMessage(message, sender) {
  switch (message.type) {
    case "DIAGNOSTIC_EVENT": {
      const allowed = ["reading.started", "reading.stopped", "reading.paused", "reading.resumed", "reading.failed", "reading.finished", "audio.error", "audio.play_failed", "page.leaving"];
      if (!allowed.includes(message.event)) return {};
      await record(message.event, { ...message.details, tabId: sender?.tab?.id });
      return {};
    }
    case "EXPORT_DIAGNOSTICS":
    case "CLEAR_DIAGNOSTICS": {
      // The popup may also be opened in an extension tab (including in tests).
      // Chrome supplies sender identity and URL; a content script cannot forge them.
      if (sender?.id !== chrome.runtime.id || sender?.url !== chrome.runtime.getURL("src/popup.html")) throw new Error("Diagnostics are available from the extension popup only.");
      if (message.type === "CLEAR_DIAGNOSTICS") { await clearLog(); return {}; }
      return { log: await exportLog() };
    }
    case "GET_LOCALE": {
      const code = String(message.locale || "").toLowerCase();
      const known = (globalThis.SesliOkuLocaleMeta?.languages || []).some(language => language.code === code);
      if (!known) throw new Error("Unknown locale.");
      return { messages: await localeMessages(code) };
    }
    case "LIBRARY_MUTATE": {
      const operation = message.operation;
      if (operation?.type === "export" && operation.value?.status === "working") operation.value.tabId = await senderTabId(sender);
      return { library: await library.mutate(operation) };
    }
    case "LIBRARY_ACTION": await library.ready; return libraryAction(message, sender);
    case "CONTENT_READY": {
      const tabId = sender?.tab?.id;
      if (tabId) {
        const key = `resume-${tabId}`; const stored = await chrome.storage.session.get(key);
        if (stored[key]) { await chrome.storage.session.remove(key); await sendToTab(tabId, { target: "content", type: "LIBRARY_ACTION", action: "resume", args: { anchor: stored[key] } }); }
        else await startQueuePage(tabId);
      }
      return {};
    }
    case "READING_FAILED":
    case "READING_FINISHED": {
      tts.close();
      const value = library.current();
      if (value.queueRunning && value.queueTabId === sender?.tab?.id && value.queueItemId === message.queueItemId) {
        await library.mutate({ type: "queueState", id: value.queueItemId, status: message.type === "READING_FAILED" ? "error" : "done", error: message.error, itemId: null });
        queueStarted.delete(sender.tab.id); await advanceQueue();
      }
      if (sender?.tab?.id === readingTabId) readingTabId = null;
      return {};
    }
    case 'EXPORT_CACHE_GET':
    case 'EXPORT_CACHE_PUT': {
      const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(JSON.stringify(message.key)));
      const id = Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
      if (message.type === 'EXPORT_CACHE_GET') return {part: await globalThis.SesliOkuVault.exportGet(id)};
      await globalThis.SesliOkuVault.exportPut(id, message.part); return {};
    }
    case 'VAULT_BEGIN': return {book:await globalThis.SesliOkuVault.begin({...message.value,ownerTabId:await senderTabId(sender)})};
    case 'VAULT_PART': await globalThis.SesliOkuVault.putPart(message.id,message.index,message.part);return {};
    case 'VAULT_FINISH': return await globalThis.SesliOkuVault.finish(message.id);
    case 'VAULT_REMOVE': await globalThis.SesliOkuVault.remove(message.id);return {};
    case "GET_VOICES":
      return getVoices();

    case "SPEAK": {
      const settings = message.settings || (await getSettings());
      const result = await tts.speak(message.text, settings);
      return {
        audio: toBase64(result.audio),
        boundaries: result.boundaries,
      };
    }

    case "STOP":
      if (!message.keepQueue && library.current().queueTabId === sender?.tab?.id) { await library.mutate({ type: "queueStop" }); await chrome.alarms.clear(QUEUE_ALARM); }
      if (sender?.tab?.id === readingTabId) readingTabId = null;
      tts.close();
      return { stopped: true };

    case "START_PAGE":
      return startOnActiveTab("START_PAGE");

    case "START_SELECTION":
      return startOnActiveTab("START_SELECTION");

    case "START_FROM_CURSOR":
      return startOnActiveTab("START_FROM_CURSOR", {
        fromPoint: message.fromPoint === true,
      });

    case "TOGGLE":
      return startOnActiveTab("TOGGLE");

    case "STOP_ACTIVE": {
      const tab = await activeTab();
      if (tab?.id) await sendToTab(tab.id, { target: "content", type: "STOP" });
      tts.close();
      return { stopped: true };
    }

    case "SET_SLEEP_TIMER": {
      const tabId = readingTabId || (await activeTab())?.id;
      if (!tabId) throw new Error(t("errors.startFirst"));
      return sendToTab(tabId, { target: "content", type: "SET_SLEEP_TIMER", timer: message.timer });
    }

    case "SET_PLAYBACK_RATE": {
      const tab = await activeTab();
      if (tab?.id) {
        await sendToTab(tab.id, {
          target: "content",
          type: "SET_PLAYBACK_RATE",
          playbackRate: message.playbackRate,
        });
      }
      return { ok: true };
    }

    default:
      throw new Error(t("errors.unknownMessage", { type: message.type }));
  }
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (!message || message.target !== "background") return false;
  handleMessage(message, sender).then(
    (data) => sendResponse({ ok: true, ...data }),
    async (error) => {
      await record("worker.request_failed", { error, tabId: sender?.tab?.id });
      sendResponse({
        ok: false,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  );
  return true;
});
