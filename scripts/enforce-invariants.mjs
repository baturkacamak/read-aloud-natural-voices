#!/usr/bin/env node
/**
 * Applies project-wide strings that must not be machine translated.
 * Run after `npm run l10n:translate`.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LOCALES_DIR = path.join(ROOT, "locales");
const meta = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, "languages.json"), "utf8"));
const invariants = JSON.parse(fs.readFileSync(path.join(LOCALES_DIR, "invariants.json"), "utf8"));

const LIMITS = { "manifest.appName": 45, "manifest.appDescription": 132 };

let updated = 0;
for (const code of Object.keys(meta.languages)) {
  const file = path.join(LOCALES_DIR, code, "translation.json");
  if (!fs.existsSync(file)) continue;
  const messages = JSON.parse(fs.readFileSync(file, "utf8"));
  let changed = false;
  if (messages["manifest.actionTitle"] !== messages["manifest.appName"]) {
    messages["manifest.actionTitle"] = messages["manifest.appName"]; changed = true;
  }
  for (const [key, value] of Object.entries(invariants)) {
    if (messages[key] === value) continue;
    messages[key] = value;
    changed = true;
  }
  for (const [key, limit] of Object.entries(LIMITS)) {
    if (typeof messages[key] !== "string") continue;
    const characters = [...messages[key]];
    if (characters.length <= limit) continue;
    messages[key] = `${characters.slice(0, limit - 1).join("")}…`;
    console.warn(`  ${code}: ${key} truncated to ${limit} characters for Chrome.`);
    changed = true;
  }
  if (!changed) continue;
  fs.writeFileSync(file, `${JSON.stringify(messages, null, 2)}\n`);
  updated++;
}
console.log(`enforce-invariants: updated ${updated} locale(s).`);
