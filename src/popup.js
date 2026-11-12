const themes = globalThis.SesliOkuThemes;
const preferences = globalThis.SesliOkuSettings;
const i18n = globalThis.SesliOkuI18n;
const t = (key, params, fallback) => (i18n ? i18n.t(key, params, fallback) : fallback ?? key);
i18n?.observe(document);
const themeStyle = document.createElement("style");
themeStyle.textContent = themes.css + preferences.css + globalThis.SesliOkuLibrary.css;
document.head.appendChild(themeStyle);
const settingsUi = preferences.mount(document.getElementById("preferences"), {
  onTimer: timer => callBackground("SET_SLEEP_TIMER", { timer }),
});
themes.subscribe(theme => themes.apply(document.body, theme));
const elements = {
  voice: settingsUi.voice,
  readPage: document.getElementById("read-page"),
  readSelection: document.getElementById("read-selection"),
  readHere: document.getElementById("read-here"),
  stop: document.getElementById("stop"),
  status: document.getElementById("status"),
};
let settings = preferences.current();
preferences.subscribe(value => { settings = value; });

let languageNamesLocale = "";
let languageNames = null;

function displayNames() {
  const current = i18n?.locale() || "tr";
  if (current !== languageNamesLocale) {
    languageNamesLocale = current;
    try {
      languageNames = new Intl.DisplayNames([current], { type: "language" });
    } catch {
      languageNames = null;
    }
  }
  return languageNames;
}

function localeLabel(locale) {
  const [language, region] = (locale || "").split("-");
  let name = language || locale;
  try {
    name = displayNames()?.of(language) || name;
  } catch {}
  name = name.charAt(0).toUpperCase() + name.slice(1);
  return region ? `${name} (${region})` : name;
}

function voiceLabel(voice) {
  const short = voice.ShortName || "";
  const pieces = short.split("-");
  let name = pieces.slice(2).join("-") || short;
  name = name.replace(/MultilingualNeural$|Neural$/, "");
  const gender =
    voice.Gender === "Female"
      ? t("common.female")
      : voice.Gender === "Male"
        ? t("common.male")
        : "";
  return gender ? `${name} · ${gender}` : name;
}

function setStatus(text, isError = false) {
  elements.status.textContent = text || "";
  elements.status.classList.toggle("error", isError);
}

async function callBackground(type, payload = {}) {
  const response = await chrome.runtime.sendMessage({
    target: "background",
    type,
    ...payload,
  });
  if (!response?.ok) {
    throw new Error(response?.error || t("errors.generic"));
  }
  return response;
}

let lastVoices = [];

function renderVoices(voices) {
  lastVoices = voices;
  const groups = new Map();
  for (const voice of voices) {
    const locale = voice.Locale || "other";
    if (!groups.has(locale)) groups.set(locale, []);
    groups.get(locale).push(voice);
  }

  const current = i18n?.locale() || "tr";
  const sorted = [...groups.keys()].sort((a, b) => {
    if (a.startsWith(current)) return -1;
    if (b.startsWith(current)) return 1;
    return localeLabel(a).localeCompare(localeLabel(b), current);
  });

  elements.voice.innerHTML = "";
  for (const locale of sorted) {
    const group = document.createElement("optgroup");
    group.label = localeLabel(locale);
    const voicesInGroup = groups
      .get(locale)
      .sort((a, b) => voiceLabel(a).localeCompare(voiceLabel(b), current));
    for (const voice of voicesInGroup) {
      const option = document.createElement("option");
      option.value = voice.ShortName;
      option.textContent = voiceLabel(voice);
      group.appendChild(option);
    }
    elements.voice.appendChild(group);
  }

  const exists = voices.some((voice) => voice.ShortName === settings.voice);
  if (!exists) {
    const option = document.createElement("option");
    option.value = settings.voice;
    option.textContent = settings.voice;
    elements.voice.appendChild(option);
  }
  elements.voice.value = settings.voice;
  settingsUi.renderVoiceChoices(voices);
}

async function start(type) {
  elements.readPage.disabled = true;
  elements.readSelection.disabled = true;
  elements.readHere.disabled = true;
  setStatus(t("popup.starting"));
  try {
    await preferences.ready;
    await callBackground(type);
    setStatus(t("popup.started"));
    setTimeout(() => window.close(), 220);
  } catch (error) {
    setStatus(error.message, true);
  } finally {
    elements.readPage.disabled = false;
    elements.readSelection.disabled = false;
    elements.readHere.disabled = false;
  }
}

async function init() {
  await preferences.ready;

  try {
    const { voices, warning } = await callBackground("GET_VOICES");
    renderVoices(voices);
    if (warning) setStatus(t("popup.voiceWarning"), true);
  } catch (error) {
    setStatus(error.message, true);
  }
}

elements.readPage.addEventListener("click", () => start("START_PAGE"));
elements.readSelection.addEventListener("click", () => start("START_SELECTION"));
elements.readHere.addEventListener("click", () => start("START_FROM_CURSOR"));

elements.stop.addEventListener("click", async () => {
  try {
    await callBackground("STOP_ACTIVE");
    setStatus(t("popup.stopped"));
  } catch (error) {
    setStatus(error.message, true);
  }
});

init();

callBackground('LIBRARY_ACTION', {action:'context'}).then(result=>preferences.setContext(result.context?.url,result.context?.speech)).catch(()=>{});

i18n?.subscribe(() => {
  if (lastVoices.length) renderVoices(lastVoices);
});

// A user-triggered download works without adding a downloads permission.
document.getElementById("export-log").addEventListener("click", async () => {
  try {
    const { log } = await callBackground("EXPORT_DIAGNOSTICS");
    const url = URL.createObjectURL(new Blob([log], { type: "text/plain;charset=utf-8" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = `read-aloud-${new Date().toISOString().replace(/[:.]/g, "-")}.log`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 30000);
  } catch (error) { setStatus(error.message, true); }
});
document.getElementById("clear-log").addEventListener("click", async () => {
  try {
    await callBackground("CLEAR_DIAGNOSTICS");
    setStatus(t("diagnostics.cleared", {}, "Logs cleared."));
  } catch (error) { setStatus(error.message, true); }
});
