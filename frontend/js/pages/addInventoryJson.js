/**
 * Normalise common ChatGPT copy/paste wrappers while preserving strict JSON
 * validation for the resulting object.
 */

const DOUBLE_QUOTES = /[\u201c\u201d\u201e\u201f\u2033\u00ab\u00bb]/g;
const ZERO_WIDTH = /[\u200b-\u200d\ufeff]/g;

export function normaliseChatGPTJsonText(raw) {
  let text = String(raw ?? "")
    .replace(ZERO_WIDTH, "")
    .replace(/\u00a0/g, " ")
    .trim();

  // Copying a ChatGPT code block often includes the markdown fence.
  text = text
    .replace(/^```(?:json)?\s*/i, "")
    .replace(/\s*```$/i, "")
    .trim();

  // Tolerate a short prose introduction/conclusion, but only keep one object.
  const firstBrace = text.indexOf("{");
  const lastBrace = text.lastIndexOf("}");
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    text = text.slice(firstBrace, lastBrace + 1);
  }

  // iOS and rich-text copy can replace JSON delimiters with typographic quotes.
  return text.replace(DOUBLE_QUOTES, '"');
}

export function parseChatGPTJson(raw) {
  const text = normaliseChatGPTJsonText(raw);
  if (!text) throw new SyntaxError("The pasted response is empty.");
  const parsed = JSON.parse(text);
  if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") {
    throw new SyntaxError("The pasted response must be one JSON object.");
  }
  return parsed;
}
