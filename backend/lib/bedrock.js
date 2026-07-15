const { BedrockRuntimeClient, ConverseCommand } = require("@aws-sdk/client-bedrock-runtime");
const { jsonrepair } = require("jsonrepair");

// Opus 4.8 for generating creative, sophisticated attack prompts
const GENERATOR_MODEL = process.env.GENERATOR_MODEL_ID || "us.anthropic.claude-opus-4-8";
// Sonnet 5 for fast, precise response analysis
const ANALYZER_MODEL  = process.env.ANALYZER_MODEL_ID  || "us.anthropic.claude-sonnet-5";

let client;

function getClient() {
  if (!client) {
    client = new BedrockRuntimeClient({ region: process.env.AWS_REGION || "us-east-1" });
  }
  return client;
}

/**
 * Invoke Claude via Bedrock Converse API.
 * Returns the raw text response string.
 * Pass role: "generator" | "analyzer" to pick the right model.
 */
// Models that no longer accept the temperature parameter
const TEMPERATURE_DEPRECATED_PREFIXES = ["claude-opus-4", "claude-sonnet-5", "claude-fable-5"];

function supportsTemperature(modelId) {
  return !TEMPERATURE_DEPRECATED_PREFIXES.some((prefix) => modelId.includes(prefix));
}

async function invokeModel({ systemPrompt, userMessage, temperature = 0.7, maxTokens = 4096, role = "analyzer" }) {
  const modelId = role === "generator" ? GENERATOR_MODEL : ANALYZER_MODEL;

  const inferenceConfig = { maxTokens };
  if (supportsTemperature(modelId)) {
    inferenceConfig.temperature = temperature;
  }

  const command = new ConverseCommand({
    modelId,
    system: [{ text: systemPrompt }],
    messages: [
      {
        role: "user",
        content: [{ text: userMessage }],
      },
    ],
    inferenceConfig,
  });

  const response = await getClient().send(command);
  const content = response?.output?.message?.content || [];
  // Extended thinking models return multiple blocks (reasoningContent + text).
  // Always pick the block that carries the actual text response.
  const textBlock = content.find((block) => typeof block.text === "string");
  if (!textBlock) {
    console.error("[invokeModel] no text block found in response:", JSON.stringify(content));
    throw new Error("Model returned an empty response");
  }
  return textBlock.text;
}

/**
 * Parse JSON from model output, tolerating markdown fences.
 */
function parseJson(text) {
  if (!text) throw new Error("parseJson received empty input");
  const cleaned = String(text)
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();

  // 1. Try strict parse first
  try { return JSON.parse(cleaned); } catch {}

  // 2. Try jsonrepair (handles unescaped quotes, trailing commas, etc.)
  try { return JSON.parse(jsonrepair(cleaned)); } catch {}

  // 3. Extract first JSON object/array, then repair
  const match = cleaned.match(/(\{[\s\S]*\}|\[[\s\S]*\])/);
  if (match) {
    try { return JSON.parse(jsonrepair(match[0])); } catch {}
    try { return JSON.parse(match[0]); } catch {}
  }

  throw new Error(`Model did not return valid JSON. Raw: ${cleaned.slice(0, 300)}`);
}

module.exports = { invokeModel, parseJson, GENERATOR_MODEL, ANALYZER_MODEL };
