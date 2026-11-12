#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = file => JSON.parse(fs.readFileSync(path.join(root, file), "utf8"));
const meta = read("locales/languages.json");
const brand = read("locales/invariants.json")["app.name"];
const problems = [];
for (const code of Object.keys(meta.languages)) {
  const catalog = read(`locales/${code}/translation.json`);
  const file = path.join(root, "store-assets/descriptions", `${code}.txt`);
  const title = catalog["manifest.appName"];
  const short = catalog["manifest.appDescription"];
  if (!title || title.length > 45) problems.push(`${code}: title missing or too long`);
  if (catalog["manifest.actionTitle"] !== title) problems.push(`${code}: titles differ`);
  if (!short || short.length > 132) problems.push(`${code}: short description missing or too long`);
  if (!fs.existsSync(file)) { problems.push(`${code}: long description missing`); continue; }
  const description = fs.readFileSync(file, "utf8").trim();
  if (description.length < 250 || description.length > 16000) problems.push(`${code}: invalid long description length`);
  if (!description.includes(brand)) problems.push(`${code}: product name missing`);
}
if (problems.length) { console.error(problems.join("\n")); process.exitCode = 1; }
else console.log(`Store listings: ${Object.keys(meta.languages).length} languages validated.`);
