import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const manualPath = new URL("../js/pages/manualChatGPTResearch.js", import.meta.url);

test("manual ChatGPT UI explains and preflights JSON copy-paste rules", async () => {
  const source = await readFile(manualPath, "utf8");

  assert.match(source, /normal double quotes/);
  assert.match(source, /typographic quotes/);
  assert.match(source, /never YYYY-MM/);
  assert.match(source, /parseManualChatGPTResponse/);
  assert.match(source, /JSON\.parse\(cleaned\)/);
  assert.match(source, /\^\\d\{4\}-\\d\{2\}\$/);
  assert.match(source, /response:\s*parsed/);
  assert.doesNotMatch(source, /response:\s*raw/);
});
