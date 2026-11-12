/**
 * Shared internationalization runtime.
 *
 * `src/locales/base.js` carries the base catalog plus the list of available
 * languages. Every other catalog is fetched on demand from
 * `locales/<code>/translation.json`:
 *   - extension pages and the service worker fetch the packaged JSON directly
 *   - content scripts ask the service worker, which owns the extension origin
 *
 * The chosen locale is stored in chrome.storage.local (`uiLocale`) and kept in
 * sync across popup, reader, player and service worker.
 *
 * Usage:
 *   SesliOkuI18n.t("player.prev")
 *   SesliOkuI18n.t("settings.timer.remaining", { minutes: 12 })
 *   await SesliOkuI18n.setLocale("en")
 *   const stop = SesliOkuI18n.observe(element)
 */
(() => {
  if (globalThis.SesliOkuI18n) return;

  const STORAGE_KEY = "uiLocale";
  const meta = () => globalThis.SesliOkuLocaleMeta || {};
  const BASE = meta().base || "tr";
  const catalogs = () => globalThis.SesliOkuLocales || {};
  const languages = () => meta().languages || [];
  const isExtensionPage =
    typeof location !== "undefined" && location.protocol === "chrome-extension:";
  const isContentScript =
    typeof location !== "undefined" &&
    location.protocol !== "chrome-extension:" &&
    typeof chrome !== "undefined" &&
    !!chrome.runtime?.id;

  let locale = BASE;
  let messages = {};
  let initialized = false;
  const roots = new Set();
  const listeners = new Set();
  const pending = new Map();

  function available() {
    return languages().map(({ code, label }) => ({ code, label }));
  }

  /** "en-US" / "en_US" -> "en" when that catalog exists. */
  function normalize(value) {
    const code = String(value || "")
      .trim()
      .toLowerCase()
      .replace(/_/g, "-");
    if (!code) return "";
    if (languages().some(language => language.code === code)) return code;
    const base = code.split("-")[0];
    return languages().some(language => language.code === base) ? base : "";
  }

  function load(value) {
    const next = normalize(value) || BASE;
    const changed = next !== locale || !initialized;
    locale = next;
    initialized = true;
    messages = catalogs()[next]?.messages || {};
    if (isExtensionPage && typeof document !== "undefined") {
      document.documentElement.lang = next;
      document.documentElement.dir = catalogs()[next]?.dir || "ltr";
    }
    return changed;
  }

  function interpolate(text, params) {
    if (!params || typeof params !== "object") return text;
    return String(text).replace(/\{\{\s*(\w+)\s*\}\}/g, (match, name) =>
      params[name] == null ? match : String(params[name])
    );
  }

  function t(key, params, fallback) {
    let value = messages[key];
    if (value == null) value = catalogs()[BASE]?.messages?.[key];
    if (value == null) value = fallback;
    if (value == null) return key;
    const appName = catalogs()[BASE]?.messages?.["app.name"] || "";
    const appSlug = appName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
    return interpolate(value, { appName, appSlug, ...params });
  }

  async function requestCatalog(code) {
    if (isContentScript) {
      const response = await chrome.runtime.sendMessage({
        target: "background",
        type: "GET_LOCALE",
        locale: code,
      });
      if (!response?.ok) {
        throw new Error(response?.error || `Locale ${code} could not be loaded.`);
      }
      return response.messages;
    }
    if (typeof fetch !== "function" || !chrome?.runtime?.getURL) {
      throw new Error("Locale loading is unavailable.");
    }
    const response = await fetch(
      chrome.runtime.getURL(`locales/${code}/translation.json`),
      { cache: "no-store" }
    );
    if (!response.ok) throw new Error(`Locale ${code} could not be loaded.`);
    return response.json();
  }

  function ensureCatalog(code) {
    if (code === BASE || catalogs()[code]?.messages) return Promise.resolve();
    if (pending.has(code)) return pending.get(code);
    const task = requestCatalog(code)
      .then(values => {
        if (!values || typeof values !== "object" || Array.isArray(values)) {
          throw new Error(`Locale ${code} has an invalid catalog.`);
        }
        const metadata = languages().find(language => language.code === code) || {};
        catalogs()[code] = {
          label: metadata.label || code,
          dir: metadata.dir === "rtl" ? "rtl" : "ltr",
          messages: values,
        };
      })
      .finally(() => pending.delete(code));
    pending.set(code, task);
    return task;
  }

  function translate(node, attribute, key) {
    const value = t(key);
    if (attribute === "text") node.textContent = value;
    else if (attribute === "title") node.title = value;
    else if (attribute === "placeholder") node.placeholder = value;
    else node.setAttribute(attribute, value);
  }

  function apply(root) {
    if (!root || typeof root.querySelectorAll !== "function") return;
    const nodes = root.querySelectorAll(
      "[data-i18n], [data-i18n-title], [data-i18n-aria-label], [data-i18n-placeholder]"
    );
    for (const node of nodes) {
      if (node.dataset.i18n) translate(node, "text", node.dataset.i18n);
      if (node.dataset.i18nTitle) translate(node, "title", node.dataset.i18nTitle);
      if (node.dataset.i18nAriaLabel) translate(node, "aria-label", node.dataset.i18nAriaLabel);
      if (node.dataset.i18nPlaceholder) translate(node, "placeholder", node.dataset.i18nPlaceholder);
    }
    // A root can itself be a translated node (for example a <title>).
    if (root.dataset?.i18n) translate(root, "text", root.dataset.i18n);
    if (root.dataset?.i18nTitle) translate(root, "title", root.dataset.i18nTitle);
    if (root.dataset?.i18nAriaLabel) translate(root, "aria-label", root.dataset.i18nAriaLabel);
    if (root.dataset?.i18nPlaceholder) translate(root, "placeholder", root.dataset.i18nPlaceholder);
  }

  function notify() {
    for (const root of [...roots]) {
      if (root && root.isConnected !== false) apply(root);
      else roots.delete(root);
    }
    for (const listener of [...listeners]) {
      try {
        listener(locale);
      } catch (error) {
        console.error("[Read Aloud] i18n listener failed:", error);
      }
    }
  }

  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  function observe(root) {
    roots.add(root);
    apply(root);
    return () => roots.delete(root);
  }

  function persist(value) {
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        return chrome.storage.local.set({ [STORAGE_KEY]: value });
      }
    } catch {}
    return Promise.resolve();
  }

  async function switchTo(value, { persist: store = true } = {}) {
    let next = normalize(value) || BASE;
    if (next !== BASE) {
      try {
        await ensureCatalog(next);
      } catch (error) {
        console.warn(`[Read Aloud] could not load locale "${next}":`, error?.message || error);
        next = BASE;
      }
    }
    const changed = load(next);
    if (changed) notify();
    if (store) await persist(locale);
    return locale;
  }

  function setLocale(value) {
    return switchTo(value, { persist: true });
  }

  const ready = (async () => {
    let stored;
    try {
      if (typeof chrome !== "undefined" && chrome.storage?.local) {
        stored = (await chrome.storage.local.get(STORAGE_KEY))[STORAGE_KEY];
      }
    } catch {}
    if (stored) {
      const requested = normalize(stored);
      if (requested && requested !== BASE) {
        try {
          await ensureCatalog(requested);
        } catch {}
        load(requested);
      }
    }
    notify();
    return locale;
  })();

  try {
    if (typeof chrome !== "undefined" && chrome.storage?.onChanged) {
      chrome.storage.onChanged.addListener((changes, area) => {
        if (area !== "local" || !changes[STORAGE_KEY]) return;
        const requested = normalize(changes[STORAGE_KEY].newValue) || BASE;
        (async () => {
          if (requested !== BASE) {
            try {
              await ensureCatalog(requested);
            } catch {}
          }
          if (load(requested)) notify();
        })();
      });
    }
  } catch {}

  load(BASE);

  globalThis.SesliOkuI18n = Object.freeze({
    storageKey: STORAGE_KEY,
    available,
    apply,
    baseLanguage: () => BASE,
    direction: () => catalogs()[locale]?.dir || "ltr",
    locale: () => locale,
    observe,
    ready,
    setLocale,
    subscribe,
    t,
  });
})();
