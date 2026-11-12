/**
 * Unit checks for the localization catalogs and the shared i18n runtime.
 *
 * Source of truth is the JSON under locales/. The runtime file
 * src/locales/all.js is generated and verified by `npm run locales:check`
 * before this test runs.
 *
 * Runs without a browser:
 *   npm run test:i18n
 */
import { readFileSync, readdirSync } from "node:fs";
import path from "node:path";
import vm from "node:vm";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
let passed = 0;
const failures = [];

function check(name, condition, details = "") {
  if (condition) {
    passed++;
    console.log(`  ✓ ${name}`);
  } else {
    failures.push(`${name}${details ? ` — ${details}` : ""}`);
    console.log(`  ✗ ${name}${details ? ` — ${details}` : ""}`);
  }
}

const read = file => readFileSync(path.join(ROOT, file), "utf8");
const readJson = file => JSON.parse(read(file));

const meta = readJson("locales/languages.json");
const base = meta.base;
const codes = [base, ...Object.keys(meta.languages).filter(code => code !== base).sort()];
const catalogs = Object.fromEntries(
  codes.map(code => [code, readJson(`locales/${code}/translation.json`)])
);

const placeholderNames = text =>
  [...String(text).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
    .map(match => match[1].trim())
    .sort()
    .join(",");

console.log("\n  Locale catalogs");
check("languages.json declares a base language", typeof base === "string" && !!base);
const localeDirs = readdirSync(path.join(ROOT, "locales"), { withFileTypes: true })
  .filter(entry => entry.isDirectory() && readJsonSafe(`locales/${entry.name}/translation.json`))
  .map(entry => entry.name)
  .sort();
check("every catalog directory is registered in languages.json", localeDirs.every(code => codes.includes(code)), localeDirs.filter(code => !codes.includes(code)).join(", "));
check("every registered language has a catalog", codes.every(code => !!catalogs[code]));
check("each language has a native label", codes.every(code => {
  const label = meta.languages[code]?.label;
  return typeof label === "string" && label.trim().length > 0;
}));
check("direction is ltr or rtl", codes.every(code => ["ltr", "rtl"].includes(meta.languages[code]?.dir || "ltr")));

const baseKeys = new Set(Object.keys(catalogs[base]));
for (const code of codes) {
  const keys = new Set(Object.keys(catalogs[code]));
  const missing = [...baseKeys].filter(key => !keys.has(key));
  const extra = [...keys].filter(key => !baseKeys.has(key));
  check(`${code} has every base key`, missing.length === 0, missing.join(", "));
  check(`${code} has no orphan keys`, extra.length === 0, extra.join(", "));
  check(`${code} has no empty values`, [...keys].every(key => String(catalogs[code][key]).trim().length > 0));
  check(`${code} keeps base placeholders`, [...baseKeys].every(key => placeholderNames(catalogs[base][key]) === placeholderNames(catalogs[code][key])));
}

const invariants = readJson("locales/invariants.json");
check("project invariants are applied to every language", codes.every(code =>
  Object.entries(invariants).every(([key, value]) => catalogs[code][key] === value)
));

check("brand is consistent and manifest titles match", codes.every(code => catalogs[code]["app.name"] === invariants["app.name"] && catalogs[code]["manifest.appName"] === catalogs[code]["manifest.actionTitle"]));

const manifestKeys = [...baseKeys].filter(key => key.startsWith("manifest."));
check("manifest strings are part of the catalog", manifestKeys.length >= 8, String(manifestKeys.length));
check("every language translates manifest strings", codes.every(code => manifestKeys.every(key => catalogs[code][key])));

// ---------------------------------------------------------------- runtime

const storage = {};
const chrome = {
  runtime: {
    id: "test-extension",
    getURL: resource => `chrome-extension://test-extension/${resource}`,
  },
  storage: {
    local: {
      get: async key => (key in storage ? { [key]: storage[key] } : {}),
      set: async values => Object.assign(storage, values),
    },
    onChanged: { addListener: () => {} },
  },
};
const fetchMock = async url => {
  const match = String(url).match(/^chrome-extension:\/\/[^/]+\/(.+)$/);
  const resource = match ? match[1] : String(url);
  try {
    const data = readJson(resource);
    return { ok: true, json: async () => data };
  } catch {
    return { ok: false, status: 404, json: async () => ({}) };
  }
};
const context = vm.createContext({ chrome, console, fetch: fetchMock });
for (const file of ["src/locales/base.js", "src/i18n.js"]) {
  vm.runInContext(read(file), context, { filename: file });
}
const i18n = vm.runInContext("globalThis.SesliOkuI18n", context);
const runtimeMeta = vm.runInContext("globalThis.SesliOkuLocaleMeta", context);
const runtimeCatalogs = vm.runInContext("globalThis.SesliOkuLocales", context);

console.log("\n  Generated runtime");
check("runtime metadata exposes the base language", runtimeMeta.base === base);
check("runtime metadata lists every language", runtimeMeta.languages.map(language => language.code).join(",") === codes.join(","));
check("runtime bundles only the base catalog", Object.keys(runtimeCatalogs).join(",") === base);
check("runtime base catalog preserves values", Object.entries(catalogs[base]).every(([key, value]) => runtimeCatalogs[base].messages[key] === value));

console.log("\n  Default locale");
check("defaults to the base language before storage is read", i18n.locale() === base);
check("t() returns the base string", i18n.t("popup.readPage") === catalogs[base]["popup.readPage"]);
check("t() interpolates named placeholders", i18n.t("settings.timer.remaining", { minutes: 12 }) === catalogs[base]["settings.timer.remaining"].replace("{{minutes}}", "12"));
check("product name is interpolated in the document title", i18n.t("reader.documentTitle").includes(invariants["app.name"]) && !i18n.t("reader.documentTitle").includes("{{"));
check("backup filename includes the product slug and date", i18n.t("tools.backupFilename", { date: "2026-11-01" }).includes(invariants["app.name"].toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "")) && !i18n.t("tools.backupFilename", { date: "2026-11-01" }).includes("{{"));
check("unknown keys fall back to the key", i18n.t("missing.key") === "missing.key");
check("available() lists every catalog", i18n.available().map(item => item.code).join(",") === codes.join(","));

console.log("\n  Switching locale");
await i18n.setLocale("en");
await new Promise(resolve => setTimeout(resolve, 0));
check("active locale becomes English", i18n.locale() === "en");
check("t() returns the English string", i18n.t("popup.readPage") === "Read page");
check("placeholders use the English template", i18n.t("settings.timer.remaining", { minutes: 12 }) === "Remaining: 12 min");
check("locale is persisted for other surfaces", storage.uiLocale === "en");
check("full locale tags resolve to their base language", (await i18n.setLocale("en-US")) === "en");
check("a fetched catalog is cached for reuse", !!runtimeCatalogs.en);
check("unknown locales fall back to the base language", (await i18n.setLocale("xx")) === base);

// ---------------------------------------------------------------- source keys

console.log("\n  Source keys");
const sourceFiles = [
  ...readdirSync(path.join(ROOT, "src"))
    .filter(file => file.endsWith(".js") && file !== "i18n.js")
    .map(file => `src/${file}`),
  "src/popup.html",
  "src/reader.html",
];
const used = new Set();
for (const file of sourceFiles) {
  const text = read(file);
  for (const match of text.matchAll(/\bt\(["']([^"']+)["']/g)) used.add(match[1]);
  for (const match of text.matchAll(/data-i18n(?:-title|-aria-label|-placeholder)?="([^"]+)"/g)) {
    if (!match[1].includes("${")) used.add(match[1]);
  }
  for (const match of text.matchAll(/["'](settings|player|popup|background|common|errors|units|presets|app|library|tools|experience|insights|tts|vault|ocr|reader|themes|manifest)\.[A-Za-z0-9_.]+["']/g)) {
    const key = match[0].slice(1, -1);
    if (!/\.(?:js|css|html|json|png|svg|woff2)$/.test(key)) used.add(key);
  }
}
const missing = [...used].filter(key => !baseKeys.has(key));
check("all keys used by source files exist", missing.length === 0, missing.join(", "));

console.log(`\n${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;

function readJsonSafe(file) {
  try {
    return readJson(file);
  } catch {
    return null;
  }
}
