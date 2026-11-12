#!/usr/bin/env node
/**
 * Batch wrapper around the Localization Toolkit translator.
 *
 * The toolkit's built-in google-web provider issues one HTTP request per
 * string. With dozens of languages that is tens of thousands of requests.
 * This wrapper keeps the toolkit's audit, state, cache and atomic writes but
 * sends up to `provider.batchSize` strings per request through Google's
 * translate_a/t endpoint.
 *
 * Usage:
 *   node scripts/l10n-translate.mjs
 *   node scripts/l10n-translate.mjs --languages de,fr
 *   node scripts/l10n-translate.mjs --languages de --keys /popup.readPage
 *   node scripts/l10n-translate.mjs --stale
 *   node scripts/l10n-translate.mjs --provider google-cloud
 */
import { readFileSync } from "node:fs";

import {
  createProvider,
  loadConfig,
  translateProject,
} from "@baturkacamak/localization-toolkit";

const args = process.argv.slice(2);
const option = name => {
  const index = args.indexOf(name);
  return index >= 0 ? args[index + 1] : undefined;
};
const flag = name => args.includes(name);
const list = name => option(name)
  ?.split(",")
  .map(item => item.trim())
  .filter(Boolean);

const config = loadConfig(option("--config"));
const providerName = option("--provider");
const providerConfig = config.provider ?? { type: "google-web" };
const endpoint = providerConfig.endpoint ?? "https://translate.googleapis.com/translate_a/t";
const batchSize = Math.max(1, Number(providerConfig.batchSize) || 40);
const maxChars = Math.max(200, Number(providerConfig.maxChars) || 4500);
const attempts = Math.max(1, Number(providerConfig.attempts) || 4);
const requestDelay = Math.max(0, Number(providerConfig.delayMs) || 0);

const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

// The toolkit wraps placeholders in ⟦L10Nn⟧ before calling the provider.
// Google transliterates those Latin letters for Cyrillic and some other
// targets. Swap each token for a single private-use code point while it is in
// Google's hands; the toolkit restores the original token afterwards.
const maskTokens = text => String(text).replace(/⟦L10N(\d+)⟧/g, (_, index) =>
  String.fromCodePoint(0xe000 + Number(index))
);
const unmaskTokens = text => String(text).replace(/[\ue000-\ue0ff]/g, character =>
  `⟦L10N${character.codePointAt(0) - 0xe000}⟧`
);

function parseResponse(data) {
  if (typeof data === "string") return [data];
  if (!Array.isArray(data)) {
    throw new Error("Translation endpoint returned an unexpected response.");
  }
  return data.map(item => {
    if (typeof item === "string") return item;
    if (Array.isArray(item) && typeof item[0] === "string") return item[0];
    if (item && typeof item === "object" && typeof item.trans === "string") return item.trans;
    return "";
  });
}

async function requestBatch(texts, sourceLanguage, targetLanguage) {
  const url = new URL(endpoint);
  url.searchParams.set("client", "gtx");
  url.searchParams.set("sl", sourceLanguage);
  url.searchParams.set("tl", targetLanguage);
  for (const text of texts) url.searchParams.append("q", maskTokens(text));

  let lastError;
  for (let attempt = 0; attempt < attempts; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          "user-agent": "Mozilla/5.0 (compatible; SesliOkuLocalization/1.0)",
        },
      });
      if (response.ok) {
        const values = parseResponse(await response.json()).map(unmaskTokens);
        if (values.length !== texts.length) {
          throw new Error("Translation endpoint returned an unexpected result count.");
        }
        return values;
      }
      const retryable = response.status === 429 || response.status >= 500;
      const retryAfter = (Number(response.headers.get("retry-after")) || 0) * 1000;
      const wait = Math.max(retryable ? 5000 : 500, retryAfter);
      if (!retryable || attempt === attempts - 1) {
        throw new Error(`Translation endpoint failed with HTTP ${response.status}.`);
      }
      console.warn(`  HTTP ${response.status}; retrying in ${wait * (attempt + 1)} ms…`);
      await sleep(wait * (attempt + 1));
    } catch (error) {
      lastError = error;
      if (attempt === attempts - 1) break;
      const wait = 500 * 2 ** attempt;
      console.warn(`  ${error.message} Retrying in ${wait} ms…`);
      await sleep(wait);
    }
  }
  throw lastError ?? new Error("Translation request failed.");
}

class GoogleWebBatchProvider {
  id = "google-web-batch";
  experimental = true;

  async translate({ texts, sourceLanguage, targetLanguage }) {
    const results = [];
    let batch = [];
    let characters = 0;

    const flush = async () => {
      if (!batch.length) return;
      if (requestDelay) await sleep(requestDelay);
      const values = await requestBatch(batch, sourceLanguage, targetLanguage);
      results.push(...values);
      batch = [];
      characters = 0;
    };

    for (const text of texts) {
      const size = text.length + 8;
      if (batch.length && (batch.length >= batchSize || characters + size > maxChars)) {
        await flush();
      }
      batch.push(text);
      characters += size;
    }
    await flush();
    return results;
  }
}

class LocalAiProvider {
  id = "local-ai";
  experimental = false;

  constructor() {
    this.baseUrl = (process.env.L10N_AI_BASE_URL || providerConfig.baseUrl || "http://127.0.0.1:11434/v1").replace(/\/$/, "");
    this.model = process.env.L10N_AI_MODEL || providerConfig.model || "";
    this.apiKey = process.env.L10N_AI_API_KEY || providerConfig.apiKey || "local";
    this.timeout = Math.max(5000, Number(process.env.L10N_AI_TIMEOUT_MS) || 180000);
    this.batchSize = Math.max(1, Math.min(50, Number(process.env.L10N_AI_BATCH_SIZE) || 20));
    this.attempts = Math.max(1, Number(providerConfig.attempts) || 3);
  }

  async ensureModel() {
    if (this.model) return this.model;
    const response = await fetch(`${this.baseUrl}/models`, {
      headers: { authorization: `Bearer ${this.apiKey}` },
      signal: AbortSignal.timeout(this.timeout),
    });
    if (!response.ok) {
      throw new Error(`Local AI server is not reachable at ${this.baseUrl}. Start Ollama/LM Studio or set L10N_AI_BASE_URL.`);
    }
    const data = await response.json();
    const models = (data.data || data.models || []).map(item => item.id || item.name).filter(Boolean);
    if (!models.length) throw new Error("Local AI server has no models. Load one or set L10N_AI_MODEL.");
    this.model = models[0];
    console.warn(`[local-ai] no model configured; using ${this.model}`);
    return this.model;
  }

  async translate({ texts, sourceLanguage, targetLanguage }) {
    const model = await this.ensureModel();
    const masked = texts.map(maskLocalTokens);
    const results = [];
    for (let index = 0; index < masked.length; index += this.batchSize) {
      const batch = masked.slice(index, index + this.batchSize);
      const values = await this.translateBatch(batch, sourceLanguage, targetLanguage, model);
      results.push(...values.map(unmaskLocalTokens));
      console.error(`[local-ai] ${targetLanguage} ${Math.min(index + batch.length, masked.length)}/${masked.length}`);
    }
    return results;
  }

  async translateBatch(texts, sourceLanguage, targetLanguage, model) {
    const system = [
      "You are a professional software localization engine.",
      `Translate each item from ${languageName(sourceLanguage)} (${sourceLanguage}) to ${languageName(targetLanguage)} (${targetLanguage}).`,
      "Rules:",
      "- Preserve every [[L10Nn]] token exactly as written.",
      `- Preserve the product name ${JSON.parse(readFileSync(new URL("../locales/invariants.json", import.meta.url), "utf8"))["app.name"]}, Microsoft Edge and Read Aloud.`,
      "- Preserve HTML tags, URLs, code, numbers, percentages and keyboard shortcuts.",
      "- Keep the same number of items and the same order.",
      "- Translate UI text naturally and concisely.",
      "- Return ONLY a JSON array of translated strings. No markdown, no explanations.",
    ].join("\n");
    const user = JSON.stringify(texts);
    let lastError;
    for (let attempt = 0; attempt < this.attempts; attempt++) {
      try {
        const response = await fetch(`${this.baseUrl}/chat/completions`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            authorization: `Bearer ${this.apiKey}`,
          },
          body: JSON.stringify({
            model,
            temperature: 0,
            stream: false,
            messages: [
              { role: "system", content: system },
              { role: "user", content: user },
            ],
          }),
          signal: AbortSignal.timeout(this.timeout),
        });
        if (!response.ok) {
          throw new Error(`Local AI request failed with HTTP ${response.status}.`);
        }
        const data = await response.json();
        const content = data.choices?.[0]?.message?.content ?? data.message?.content ?? "";
        const values = parseAiResponse(content);
        if (values.length !== texts.length) {
          throw new Error(`Local AI returned ${values.length} items for ${texts.length} inputs.`);
        }
        return values;
      } catch (error) {
        lastError = error;
        if (attempt < this.attempts - 1) {
          await sleep(1000 * (attempt + 1));
        }
      }
    }
    if (texts.length > 1) {
      const middle = Math.ceil(texts.length / 2);
      return [
        ...await this.translateBatch(texts.slice(0, middle), sourceLanguage, targetLanguage, model),
        ...await this.translateBatch(texts.slice(middle), sourceLanguage, targetLanguage, model),
      ];
    }
    throw lastError ?? new Error("Local AI translation failed.");
  }
}

const languageName = code => {
  try {
    return new Intl.DisplayNames(["en"], { type: "language" }).of(code) || code;
  } catch {
    return code;
  }
};

const maskLocalTokens = text => String(text).replace(/⟦L10N(\d+)⟧/g, (_, index) => `[[L10N${index}]]`);
const unmaskLocalTokens = text => String(text).replace(/\[\[\s*L10N(\d+)\s*\]\]/gi, (_, index) => `⟦L10N${index}⟧`);

function parseAiResponse(content) {
  const text = String(content || "")
    .replace(/^\s*```(?:json)?/i, "")
    .replace(/```\s*$/, "")
    .trim();
  const candidates = [text];
  const arrayStart = text.indexOf("[");
  const arrayEnd = text.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) candidates.push(text.slice(arrayStart, arrayEnd + 1));
  const objectStart = text.indexOf("{");
  const objectEnd = text.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) candidates.push(text.slice(objectStart, objectEnd + 1));
  for (const candidate of candidates) {
    try {
      const parsed = JSON.parse(candidate);
      if (Array.isArray(parsed)) return parsed.map(value => String(value ?? ""));
      const translations = parsed.translations ?? parsed.items ?? parsed.result;
      if (Array.isArray(translations)) return translations.map(value => String(value ?? ""));
    } catch {}
  }
  throw new Error("Local AI did not return a JSON array.");
}

const requestedType = providerName ?? providerConfig.type ?? "google-web";
const provider = requestedType === "google-web"
  ? new GoogleWebBatchProvider()
  : requestedType === "local-ai" || requestedType === "openai-compatible"
    ? new LocalAiProvider()
    : createProvider(config, providerName);

if (provider.experimental) {
  console.warn("Warning: google-web is an experimental, unofficial provider. Use Google Cloud or DeepL for reliable automation.");
}

const result = await translateProject(config, provider, {
  languages: list("--languages"),
  pointers: list("--keys"),
  stale: flag("--stale"),
  overwrite: flag("--overwrite"),
});

console.log(`Translated ${result.translated}; skipped ${result.skipped}; failures ${result.failures.length}.`);
for (const failure of result.failures) {
  console.error(`${failure.language} ${failure.pointer}: ${failure.message}`);
}
if (result.failures.length) process.exitCode = 1;
