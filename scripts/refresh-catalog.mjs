// Regenerates lib/endpoints/catalog.ts from a live models.dev snapshot.
//
//   curl -o /tmp/api.json https://models.dev/api.json
//   node scripts/refresh-catalog.mjs /tmp/api.json
//
// The output is reviewed and committed like any other source file: the Catalog
// decides which address a Credential is sent to, so a changed base URL has to
// arrive as a diff rather than over the network at request time.
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";

const source = process.argv[2];
if (!source) {
  console.error("usage: node scripts/refresh-catalog.mjs <path-to-models.dev-api.json>");
  process.exit(1);
}

const raw = JSON.parse(readFileSync(resolve(source), "utf8"));

/**
 * SDKs whose providers are addressed in the OpenAI chat format.
 *
 * `@ai-sdk/openai-compatible` is models.dev's own flag for exactly this. The
 * other two are formats that are OpenAI-shaped too: OpenRouter and the
 * `@ai-sdk/openai` gateways all serve `/chat/completions` with the same request
 * body. The flag is a useful signal, not a sufficient one — the majors a
 * developer reaches for first (OpenAI, Gemini) ship a vendor SDK instead, and
 * are added by hand below.
 */
const OPENAI_SHAPED_NPM = new Set([
  "@ai-sdk/openai-compatible",
  "@openrouter/ai-sdk-provider",
  "@ai-sdk/openai",
]);

/**
 * Cloud Endpoints that need a base URL models.dev does not carry.
 *
 * Each is a provider that publishes an OpenAI-compatible address alongside its
 * own SDK. They are written out here rather than derived, because this file
 * decides where a Credential is sent: an address entered by hand is one a
 * reviewer can check against the provider's documentation, and one that shows
 * up in a diff when it changes.
 *
 * Each `defaultModel` was taken from the provider's documentation as of the
 * snapshot date below. It is only the starting Model — Model Discovery asks the
 * Endpoint for the rest.
 */
const HAND_ADDED = [
  {
    id: "openai",
    name: "OpenAI",
    baseURL: "https://api.openai.com/v1",
    credentialEnvVar: "OPENAI_API_KEY",
    doc: "https://platform.openai.com/docs/models",
    capabilities: ["reasoning", "toolCalling", "imageInput", "structuredOutput"],
    knownModels: ["gpt-5.4", "gpt-5.4-mini", "gpt-5.4-nano"],
    note: "models.dev carries no base URL for OpenAI; this is the documented one.",
  },
  {
    id: "google",
    name: "Google Gemini",
    baseURL: "https://generativelanguage.googleapis.com/v1beta/openai",
    credentialEnvVar: "GOOGLE_API_KEY",
    doc: "https://ai.google.dev/gemini-api/docs/models",
    capabilities: ["reasoning", "toolCalling", "imageInput", "structuredOutput"],
    knownModels: ["gemini-3-pro-preview", "gemini-3-flash-preview", "gemini-2.5-pro"],
    note: "models.dev lists three aliases for this Credential (GOOGLE_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY, GEMINI_API_KEY). The first is used here.",
  },
  {
    id: "groq",
    name: "Groq",
    baseURL: "https://api.groq.com/openai/v1",
    credentialEnvVar: "GROQ_API_KEY",
    doc: "https://console.groq.com/docs/models",
    capabilities: ["toolCalling", "imageInput", "structuredOutput"],
    knownModels: ["qwen/qwen3.8-27b", "llama-3.3-70b-versatile", "openai/gpt-oss-120b"],
    note: "models.dev carries no base URL for Groq; this is its documented OpenAI-compatible one.",
  },
  {
    id: "mistral",
    name: "Mistral",
    baseURL: "https://api.mistral.ai/v1",
    credentialEnvVar: "MISTRAL_API_KEY",
    doc: "https://docs.mistral.ai/getting-started/models/",
    capabilities: ["toolCalling", "structuredOutput"],
    knownModels: ["mistral-large-4-0", "mistral-medium-3.1", "magistral-medium-3.1"],
    note: "models.dev carries no base URL for Mistral; this is its documented OpenAI-compatible one.",
  },
];

/**
 * Credential variables this project owns rather than inherits.
 *
 * models.dev lists each vendor's international and Chinese services under one
 * environment variable name while addressing them at different hosts. Those are
 * separate accounts with separate Credentials, so one name reaching two hosts
 * would Configure four Endpoints at once and proxy the value to two different
 * companies' servers (one a `.cn` host) through Key Entry. The Catalog exists
 * so a Credential goes only where a reviewer chose to send it, so each of these
 * is renamed to name the one service it belongs to.
 *
 * Entries sharing a variable AND a host (llmgateway, opencode) are the same
 * Credential listed twice and are deliberately absent here.
 *
 * validateCatalog() fails the module load if any variable ever spans two hosts
 * again, so a re-snapshot that grows a new regional pair is caught rather than
 * shipped.
 */
const CREDENTIAL_VAR_RENAMES = {
  alibaba: "DASHSCOPE_API_KEY",
  "alibaba-cn": "DASHSCOPE_CN_API_KEY",
  "alibaba-coding-plan": "ALIBABA_CODING_PLAN_API_KEY",
  "alibaba-coding-plan-cn": "ALIBABA_CODING_PLAN_CN_API_KEY",
  "alibaba-token-plan": "ALIBABA_TOKEN_PLAN_API_KEY",
  "alibaba-token-plan-cn": "ALIBABA_TOKEN_PLAN_CN_API_KEY",
  "kimi-code-plan-global": "KIMI_API_KEY",
  "kimi-code-plan-cn": "KIMI_CN_API_KEY",
  moonshotai: "MOONSHOT_API_KEY",
  "moonshotai-cn": "MOONSHOT_CN_API_KEY",
  stepfun: "STEPFUN_API_KEY",
  "stepfun-ai": "STEPFUN_AI_API_KEY",
  "stepfun-step-plan": "STEPFUN_STEP_PLAN_API_KEY",
  "stepfun-ai-step-plan": "STEPFUN_AI_STEP_PLAN_API_KEY",
  xiaomi: "XIAOMI_API_KEY",
  "xiaomi-token-plan-cn": "XIAOMI_TOKEN_PLAN_CN_API_KEY",
  "xiaomi-token-plan-ams": "XIAOMI_TOKEN_PLAN_AMS_API_KEY",
  "xiaomi-token-plan-sgp": "XIAOMI_TOKEN_PLAN_SGP_API_KEY",
  zai: "ZAI_API_KEY",
  "zai-coding-plan": "ZAI_CODING_PLAN_API_KEY",
  zhipuai: "ZHIPUAI_API_KEY",
  "zhipuai-coding-plan": "ZHIPUAI_CODING_PLAN_API_KEY",
};

/**
 * Models kept per provider. A full listing runs to several megabytes, and Model
 * Discovery asks an Endpoint for its live Models anyway, so this is a
 * representative sample rather than the whole catalogue.
 */
const KNOWN_MODELS_PER_PROVIDER = 5;

const dropped = {
  otherFormat: 0,
  templatedBaseUrl: 0,
  loopback: 0,
  noTextModels: 0,
  noBaseUrl: 0,
  supersededByHand: 0,
};

/** Ids written out by hand below; the snapshot's own entry is not duplicated. */
const HAND_ADDED_IDS = new Set(HAND_ADDED.map((entry) => entry.id));

function hostnameOf(api) {
  try {
    return new URL(api).hostname;
  } catch {
    return null;
  }
}

const entries = [];

for (const provider of Object.values(raw)) {
  // One integration serves every Cloud Endpoint, so only providers addressed in
  // the OpenAI chat format belong here.
  if (!OPENAI_SHAPED_NPM.has(provider.npm)) {
    dropped.otherFormat++;
    continue;
  }

  if (HAND_ADDED_IDS.has(provider.id)) {
    dropped.supersededByHand++;
    continue;
  }

  // A base URL carrying an unsubstituted ${...} placeholder is a template, not
  // an address. Left out rather than completed with a guess: guessing here would
  // mean guessing where a Credential is sent.
  if (provider.api?.includes("${")) {
    dropped.templatedBaseUrl++;
    continue;
  }

  // Loopback addresses are Local Endpoints, and the Catalog does not cover them.
  if (["localhost", "127.0.0.1", "0.0.0.0"].includes(hostnameOf(provider.api))) {
    dropped.loopback++;
    continue;
  }

  if (!provider.api) {
    dropped.noBaseUrl++;
    continue;
  }

  // Only Models that answer with text can hold a Conversation.
  const textModels = Object.values(provider.models ?? {}).filter((model) =>
    (model.modalities?.output ?? []).includes("text"),
  );
  if (textModels.length === 0) {
    dropped.noTextModels++;
    continue;
  }

  const newestFirst = textModels
    .slice()
    .sort((a, b) => b.release_date.localeCompare(a.release_date) || a.id.localeCompare(b.id));

  entries.push({
    id: provider.id,
    name: provider.name,
    baseURL: provider.api,
    credentialEnvVar: CREDENTIAL_VAR_RENAMES[provider.id] ?? provider.env[0],
    doc: provider.doc,
    capabilities: [
      textModels.some((model) => model.reasoning === true) && "reasoning",
      textModels.some((model) => model.tool_call === true) && "toolCalling",
      textModels.some((model) => model.attachment === true) && "imageInput",
      textModels.some((model) => model.structured_output === true) && "structuredOutput",
    ].filter(Boolean),
    knownModels: newestFirst.slice(0, KNOWN_MODELS_PER_PROVIDER).map((model) => model.id),
  });
}

for (const added of HAND_ADDED) {
  entries.push({ ...added, handAdded: true });
}

// Sorted so a re-snapshot produces a diff of what actually changed rather than
// a reshuffle.
entries.sort((a, b) => a.name.localeCompare(b.name) || a.id.localeCompare(b.id));

const quote = (value) => JSON.stringify(value);

function render(entry) {
  const lines = [
    "  {",
    `    id: ${quote(entry.id)},`,
    `    name: ${quote(entry.name)},`,
    `    baseURL: ${quote(entry.baseURL)},`,
    `    credentialEnvVar: ${quote(entry.credentialEnvVar)},`,
    `    doc: ${quote(entry.doc)},`,
    `    capabilities: [${entry.capabilities.map(quote).join(", ")}],`,
    "    knownModels: [",
    ...entry.knownModels.map((model) => `      ${quote(model)},`),
    "    ],",
  ];

  // Carried through rather than dropped, so a reviewer can tell an address that
  // came from models.dev from one someone typed.
  if (entry.handAdded) lines.push(`    handAdded: true, // ${entry.note}`);

  lines.push("  },");
  return lines.join("\n");
}

const summary = [
  "Every Cloud Endpoint here is addressed in the OpenAI chat format, because one",
  "integration drives them all and a per-provider adapter is out of scope. Most come",
  'from models.dev\'s own `npm: "@ai-sdk/openai-compatible"` flag; OpenRouter and the',
  "`@ai-sdk/openai` gateways serve the same request body.",
  "",
  `- ${dropped.otherFormat} left out: they answer in a format of their own.`,
  `- ${dropped.templatedBaseUrl} left out: their base URL is a \`\${...}\` template awaiting an`,
  "  account-specific value, and completing one would mean guessing where a Credential is sent.",
  `- ${dropped.loopback} left out: loopback addresses, which are Local Endpoints. The Catalog does`,
  "  not cover Local Endpoints; they are declared by hand in registry.ts. Ollama, the local",
  "  server this app is built around, is absent from models.dev entirely.",
  `- ${HAND_ADDED.length} written out by hand rather than snapshotted: OpenAI, Gemini, Groq and`,
  "  Mistral each publish a first-party SDK rather than the compatibility one, and three of",
  "  them carry no base URL in models.dev at all. Each is marked `handAdded` below so a",
  "  reviewer can tell a hand-written address from a snapshotted one at a glance.",
  `- Each provider keeps its ${KNOWN_MODELS_PER_PROVIDER} newest text-output Models. The full listing is`,
  "  several megabytes, and Model Discovery asks an Endpoint for its live Models anyway.",
  "",
  "The Credential variable names are corrected by this script rather than copied",
  "from models.dev: upstream lists each vendor's international and Chinese",
  "services under one name at two different addresses, and those are separate",
  "accounts holding separate Credentials. One name reaching two hosts would Configure",
  "every Entry sharing it and send the value to each of those servers, which is not",
  "an address any reader chose. validateCatalog() fails the load if a variable ever",
  "spans two hosts again.",
].join("\n");

const output = `/**
 * The Catalog: the reviewed set of known Cloud Endpoints, snapshotted from the
 * community-maintained models.dev database.
 *
 * This file is source code and is reviewed as such. It decides which address a
 * Credential is sent to, so a changed base URL has to arrive as a diff rather
 * than silently over the network. Nothing fetches models.dev at runtime: a live
 * catalog would make credential forwarding depend on a third party's integrity
 * on every request.
 *
 * Regenerate with \`node scripts/refresh-catalog.mjs <models.dev-api.json>\`, then
 * review the diff before committing it. validateCatalog() checks the result
 * before anything is allowed to send a Credential anywhere.
 *
 * What this snapshot covers, and what it leaves out:
 *
${summary.replace(/^/gm, " * ").replace(/^ \* $/gm, " *")}
 */

import type { CatalogEntry } from "./types";

export type { CatalogEntry };

/** The snapshot itself, filtered by the refresh script and nothing else. */
export const CATALOG: readonly CatalogEntry[] = [
${entries.map(render).join("\n")}
];
`;

writeFileSync(resolve("lib/endpoints/catalog.ts"), output);

console.log(`wrote lib/endpoints/catalog.ts: ${entries.length} Cloud Endpoints`);
console.log("dropped:", dropped);
console.log("bytes:", output.length);