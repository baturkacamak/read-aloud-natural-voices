#!/usr/bin/env node
/**
 * Creates an empty locale catalog and registers its metadata.
 *
 * Usage:
 *   npm run l10n:add -- de Deutsch
 *   npm run l10n:add -- ar العربية rtl
 *
 * Then translate and rebuild:
 *   npm run l10n:translate -- --languages de
 *   npm run locales:build
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = path.join(ROOT, "locales");
const META_FILE = path.join(LOCALES_DIR, "languages.json");
const [code, label, dir = "ltr"] = process.argv.slice(2);

if (!code || !label) {
  console.error("Usage: npm run l10n:add -- <code> <native label> [ltr|rtl]");
  process.exit(1);
}
if (!/^[a-z]{2,3}(-[a-z0-9]{2,8})*$/.test(code)) {
  console.error(`Invalid language code "${code}". Use a lowercase BCP 47 code such as pt-br.`);
  process.exit(1);
}
if (!["ltr", "rtl"].includes(dir)) {
  console.error('Direction must be "ltr" or "rtl".');
  process.exit(1);
}

const meta = JSON.parse(fs.readFileSync(META_FILE, "utf8"));
if (code === meta.base) {
  console.error(`"${code}" is the base language.`);
  process.exit(1);
}
if (meta.languages[code]) {
  console.error(`"${code}" is already registered in locales/languages.json.`);
  process.exit(1);
}

const directory = path.join(LOCALES_DIR, code);
if (fs.existsSync(directory)) {
  console.error(`locales/${code} already exists.`);
  process.exit(1);
}

meta.languages[code] = { label, dir };
const ordered = Object.fromEntries(
  [meta.base, ...Object.keys(meta.languages).filter(item => item !== meta.base).sort()]
    .filter(item => meta.languages[item])
    .map(item => [item, meta.languages[item]])
);
meta.languages = ordered;

fs.mkdirSync(directory, { recursive: true });
fs.writeFileSync(path.join(directory, "translation.json"), "{}\n");
fs.writeFileSync(META_FILE, `${JSON.stringify(meta, null, 2)}\n`);

console.log(`Created locales/${code}/translation.json and registered ${label} (${code}, ${dir}).`);
console.log("");
console.log("Next step:");
console.log(`  npm run l10n:translate -- --languages ${code}`);
console.log("");
console.log("This translates missing keys, applies brand invariants and rebuilds the extension files.");
