#!/usr/bin/env node
/**
 * Regenerates the runtime locale catalog and Chrome manifest messages from
 * the JSON files under locales/.
 *
 * Source of truth:
 *   locales/languages.json            language metadata
 *   locales/<code>/translation.json   one flat key/value catalog per language
 *
 * Generated files:
 *   src/locales/base.js               metadata + base catalog, loaded synchronously
 *   _locales/<code>/messages.json     manifest name/description/commands
 *
 * Other languages are fetched on demand from locales/<code>/translation.json.
 *
 * Usage:
 *   node scripts/build-locales.mjs
 *   node scripts/build-locales.mjs --check
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = path.join(ROOT, "locales");
const META_FILE = path.join(LOCALES_DIR, "languages.json");
const GENERATED_JS = path.join(ROOT, "src", "locales", "base.js");
const CHROME_LOCALES_DIR = path.join(ROOT, "_locales");
const CHECK = process.argv.includes("--check");

const readJson = file => JSON.parse(fs.readFileSync(file, "utf8"));
const fail = message => {
  console.error(`build-locales: ${message}`);
  process.exitCode = 1;
};

function placeholderNames(value) {
  return [...String(value).matchAll(/\{\{\s*([^}]+?)\s*\}\}/g)]
    .map(match => match[1].trim())
    .sort()
    .join(",");
}

function readLanguages() {
  if (!fs.existsSync(META_FILE)) throw new Error(`Missing ${path.relative(ROOT, META_FILE)}`);
  const meta = readJson(META_FILE);
  if (!meta.base) throw new Error("languages.json is missing the base language.");
  if (!meta.languages || typeof meta.languages !== "object") {
    throw new Error("languages.json is missing the languages map.");
  }
  return meta;
}

function discoverCatalogs(meta) {
  const directories = fs
    .readdirSync(LOCALES_DIR, { withFileTypes: true })
    .filter(entry => entry.isDirectory())
    .map(entry => entry.name);

  if (!directories.includes(meta.base)) {
    throw new Error(`Base language "${meta.base}" has no locales/${meta.base}/translation.json.`);
  }

  const codes = new Set([...Object.keys(meta.languages), ...directories]);
  const ordered = [meta.base, ...[...codes].filter(code => code !== meta.base).sort()];

  for (const code of directories) {
    if (!meta.languages[code]) {
      console.warn(`build-locales: locales/${code} has no metadata in languages.json (using "${code}").`);
    }
  }

  return ordered.map(code => {
    const file = path.join(LOCALES_DIR, code, "translation.json");
    if (!fs.existsSync(file)) {
      throw new Error(`locales/${code}/translation.json is missing. Run npm run l10n:add first.`);
    }
    const messages = readJson(file);
    const metadata = meta.languages[code] || {};
    if (!/^[a-z0-9]+(-[a-z0-9]+)*$/.test(code)) {
      throw new Error(`Invalid language code "${code}". Use lowercase BCP 47 codes such as pt-br.`);
    }
    if (code === meta.base && !Object.keys(messages).length) {
      throw new Error(`The base catalog locales/${code}/translation.json is empty.`);
    }
    for (const [key, value] of Object.entries(messages)) {
      if (typeof value !== "string") throw new Error(`${code}: ${key} must be a string.`);
      if (!value.trim()) throw new Error(`${code}: ${key} is empty.`);
    }
    return {
      code,
      label: String(metadata.label || code),
      dir: metadata.dir === "rtl" ? "rtl" : "ltr",
      chrome: metadata.chrome || code.replace(/-/g, "_"),
      messages,
    };
  });
}

function sortMessages(messages) {
  return Object.fromEntries(Object.keys(messages).sort().map(key => [key, messages[key]]));
}

function validatePlaceholders(catalogs, baseCode) {
  const base = catalogs.find(catalog => catalog.code === baseCode);
  const baseValues = base.messages;
  for (const catalog of catalogs) {
    if (catalog.code === baseCode) continue;
    for (const [key, value] of Object.entries(catalog.messages)) {
      if (!(key in baseValues)) continue;
      if (placeholderNames(baseValues[key]) !== placeholderNames(value)) {
        throw new Error(
          `${catalog.code}: ${key} changes placeholders ` +
            `(${placeholderNames(baseValues[key]) || "none"} -> ${placeholderNames(value) || "none"}).`
        );
      }
    }
  }
}

function renderRuntime(catalogs, baseCode) {
  const meta = {
    base: baseCode,
    languages: catalogs.map(catalog => ({
      code: catalog.code,
      label: catalog.label,
      dir: catalog.dir,
    })),
  };
  const base = catalogs.find(catalog => catalog.code === baseCode);
  const messages = JSON.stringify(sortMessages(base.messages), null, 2)
    .split("\n")
    .map((line, index) => (index === 0 ? line : `    ${line}`))
    .join("\n");
  return `/**
 * AUTO-GENERATED FILE — do not edit.
 *
 * Source: locales/<code>/translation.json
 * Regenerate: npm run locales:build
 *
 * Only the base catalog is bundled. Other languages are fetched on demand
 * from locales/<code>/translation.json by src/i18n.js.
 */
globalThis.SesliOkuLocaleMeta = ${JSON.stringify(meta, null, 2)};
globalThis.SesliOkuLocales = {
  ${JSON.stringify(base.code)}: {
    "label": ${JSON.stringify(base.label)},
    "dir": ${JSON.stringify(base.dir)},
    "messages": ${messages}
  }
};
`;
}

function chromeLocaleCode(catalog) {
  return catalog.chrome || catalog.code.replace(/-/g, "_");
}

const CHROME_LIMITS = { appName: 45, appDescription: 132 };

function renderChromeMessages(catalogs, baseCode) {
  const base = catalogs.find(catalog => catalog.code === baseCode);
  const result = new Map();
  for (const catalog of catalogs) {
    const messages = {};
    for (const [key, value] of Object.entries(base.messages)) {
      if (!key.startsWith("manifest.")) continue;
      const name = key.slice("manifest.".length);
      if (!name) continue;
      const translated = catalog.messages[key] ?? value;
      const limit = CHROME_LIMITS[name];
      if (limit && [...translated].length > limit) {
        throw new Error(
          `${catalog.code}: ${key} is ${[...translated].length} characters; Chrome allows ${limit}.`
        );
      }
      // Chrome treats $name$ as a placeholder; escape literal dollars.
      messages[name] = { message: translated.replace(/\$/g, () => "$$") };
    }
    const sorted = Object.fromEntries(
      Object.keys(messages)
        .sort()
        .map(key => [key, messages[key]])
    );
    result.set(
      chromeLocaleCode(catalog),
      `${JSON.stringify(sorted, null, 2)}\n`
    );
  }
  return result;
}

function writeFile(file, content) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const previous = fs.existsSync(file) ? fs.readFileSync(file, "utf8") : null;
  if (previous === content) return false;
  if (CHECK) {
    fail(`${path.relative(ROOT, file)} is out of date. Run npm run locales:build.`);
    return false;
  }
  fs.writeFileSync(file, content);
  console.log(`  updated ${path.relative(ROOT, file)}`);
  return true;
}

function main() {
  console.log(`build-locales: ${CHECK ? "checking" : "generating"} locales from locales/`);
  const meta = readLanguages();
  const catalogs = discoverCatalogs(meta);
  validatePlaceholders(catalogs, meta.base);
  const brand = readJson(path.join(LOCALES_DIR, "invariants.json"))["app.name"];
  for (const catalog of catalogs) {
    for (const key of ["app.name"]) {
      if (catalog.messages[key] !== brand) throw new Error(`${catalog.code}: ${key} does not match the product name. Run npm run locales:build.`);
    }
    if (catalog.messages["manifest.actionTitle"] !== catalog.messages["manifest.appName"]) throw new Error(`${catalog.code}: manifest titles differ.`);
  }

  writeFile(GENERATED_JS, renderRuntime(catalogs, meta.base));

  const chromeMessages = renderChromeMessages(catalogs, meta.base);
  for (const [code, content] of chromeMessages) {
    writeFile(path.join(CHROME_LOCALES_DIR, code, "messages.json"), content);
  }
  if (!CHECK && fs.existsSync(CHROME_LOCALES_DIR)) {
    for (const entry of fs.readdirSync(CHROME_LOCALES_DIR, { withFileTypes: true })) {
      if (!entry.isDirectory() || chromeMessages.has(entry.name)) continue;
      fs.rmSync(path.join(CHROME_LOCALES_DIR, entry.name), { recursive: true, force: true });
      console.log(`  removed _locales/${entry.name}`);
    }
  }

  if (!CHECK) {
    // The runtime loads the base bundle once and fetches other languages on
    // demand, so per-language JS files are no longer needed.
    for (const file of fs.readdirSync(path.dirname(GENERATED_JS))) {
      if (!file.endsWith(".js") || file === "base.js") continue;
      fs.rmSync(path.join(path.dirname(GENERATED_JS), file));
      console.log(`  removed src/locales/${file}`);
    }
  }

  console.log(
    `build-locales: ${catalogs.length} language(s), ` +
      `${Object.keys(catalogs.find(catalog => catalog.code === meta.base).messages).length} base keys.`
  );
}

try {
  main();
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}
