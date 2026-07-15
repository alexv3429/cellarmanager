import assert from "node:assert/strict";
import test from "node:test";

import {
  normaliseChatGPTJsonText,
  parseChatGPTJson,
} from "../js/pages/addInventoryJson.js";

test("parses a fenced ChatGPT JSON response", () => {
  const parsed = parseChatGPTJson('```json\n{"identity":{"producer":"Example"}}\n```');
  assert.equal(parsed.identity.producer, "Example");
});

test("repairs typographic double quotes copied from rich text", () => {
  const parsed = parseChatGPTJson('Introduction\n{“identity”:{“producer”:“Burgaud”}}\nDone');
  assert.equal(parsed.identity.producer, "Burgaud");
});

test("retains strict JSON parsing after presentation cleanup", () => {
  assert.throws(() => parseChatGPTJson('{“identity”:{“producer”:“Example”,}}'));
});

test("normaliser removes zero-width and non-breaking spaces", () => {
  const cleaned = normaliseChatGPTJsonText('\ufeff{\u00a0“identity”: {}\u200b}');
  assert.equal(cleaned, '{ "identity": {}}');
});
