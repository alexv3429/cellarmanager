#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import { assertSafeOutputPath } from "./provider_trial.mjs";
import {
  loadKnowledge,
  runInferencePoc,
  validatePocSample,
} from "./inference_model.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultKnowledgePath = resolve(
  scriptDirectory,
  "inference_poc_knowledge.json",
);

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

export function parseOptions(argv) {
  const options = {
    sample: null,
    knowledge: defaultKnowledgePath,
    output: null,
  };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--sample", "--knowledge", "--output"].includes(option)) {
      throw new Error(
        "Usage: inference_poc.mjs --sample <private-json> [--knowledge <json>] --output <private-html>",
      );
    }
    options[option.slice(2)] = resolve(value);
  }
  if (!options.sample || !options.output) {
    throw new Error("Sample and output are required");
  }
  assertSafeOutputPath(options.output);
  return options;
}

function yearRange(range) {
  return `${range[0]}–${range[1]}`;
}

function reviewControl(name, label) {
  return `<label>${escapeHtml(label)}
    <select data-review="${escapeHtml(name)}"><option value="">Choose…</option>
      <option value="useful">Useful</option><option value="questionable">Questionable</option>
      <option value="wrong">Wrong</option><option value="unsure">Unsure</option>
    </select></label>
    <label>Notes<textarea data-review="${escapeHtml(name)}.notes" rows="2" placeholder="What would you change?"></textarea></label>`;
}

function sourceLinks(evidence, sourceIndex) {
  return evidence
    .map((id) => sourceIndex.get(id))
    .filter(Boolean)
    .map((source) => {
      const label = escapeHtml(source.name);
      return source.url
        ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noreferrer">${label}</a>`
        : `<span>${label}</span>`;
    })
    .join(" · ");
}

function inferenceCard(inference, sourceIndex) {
  const wine = inference.wine;
  if (inference.status !== "inferred") {
    return `<article class="wine-card blocked"><header><h2>${escapeHtml(wine.producer)} — ${escapeHtml(wine.cuvee)} ${escapeHtml(wine.vintage)}</h2></header>
      <p>No inference: ${escapeHtml(inference.warnings.join(" "))}</p>
      ${reviewControl(`${inference.sampleId}.maturity`, "Maturity conclusion")}</article>`;
  }
  const workbookWindow = wine.workbookWindow;
  const comparison = workbookWindow
    ? `<p><strong>Workbook benchmark:</strong> ${escapeHtml(workbookWindow.from ?? "?")}–${escapeHtml(workbookWindow.to ?? "?")}${workbookWindow.manual ? " (manual)" : " (formula-derived)"}</p>
       ${wine.workbookComment ? `<p class="meta">${escapeHtml(wine.workbookComment)}</p>` : ""}`
    : '<p class="meta">No workbook benchmark supplied.</p>';
  const warnings = inference.warnings.length
    ? `<ul class="warnings">${inference.warnings.map((warning) => `<li>${escapeHtml(warning)}</li>`).join("")}</ul>`
    : "";
  const reasons = inference.reasons
    .map((reason) => `<li>${escapeHtml(reason)}</li>`)
    .join("");
  return `<article class="wine-card">
    <header><div><span class="badge state-${escapeHtml(inference.maturity.state)}">${escapeHtml(inference.maturity.stateLabel)}</span>
      <h2>${escapeHtml(wine.producer)} — ${escapeHtml(wine.cuvee)}</h2>
      <p>${escapeHtml(wine.vintage)} · ${escapeHtml(wine.appellation)} · ${escapeHtml(wine.color)} · ${escapeHtml(wine.quantity)} bottle${wine.quantity === 1 ? "" : "s"}</p></div>
      <span class="confidence">${escapeHtml(inference.confidenceLabel)} confidence (${escapeHtml(inference.confidence)})</span></header>
    <div class="recommendation"><strong>${escapeHtml(inference.maturity.message)}</strong></div>
    <div class="ranges">
      <span><small>First trial</small>${escapeHtml(yearRange(inference.maturity.firstTry))}</span>
      <span><small>Likely best</small>${escapeHtml(yearRange(inference.maturity.likelyBest))}</span>
      <span><small>Preferably drink by</small>${escapeHtml(yearRange(inference.maturity.drinkBy))}</span>
    </div>
    <div class="columns"><section><h3>Storage action</h3><p>${escapeHtml(inference.location.message)}</p>
      <p class="meta">Purpose: ${escapeHtml(inference.location.purpose)}</p></section>
      <section><h3>Previous workbook</h3>${comparison}</section></div>
    ${warnings}
    <details><summary>Why and from which evidence?</summary><ul>${reasons}</ul>
      <p class="sources">${sourceLinks(inference.evidence, sourceIndex)}</p>
      <p class="meta">Profiles: ${escapeHtml(Object.values(inference.matchedProfiles).filter(Boolean).join(" · "))}</p></details>
    <div class="review">${reviewControl(`${inference.sampleId}.maturity`, "Maturity conclusion")}</div>
  </article>`;
}

function pairingCard(pairing) {
  const suggestions = pairing.suggestions
    .map(
      (suggestion, index) => `<li><strong>${index + 1}. ${escapeHtml(suggestion.wine.producer)} — ${escapeHtml(suggestion.wine.cuvee)} ${escapeHtml(suggestion.wine.vintage)}</strong>
        <span class="score">${escapeHtml(suggestion.score)}/100</span>
        <p class="meta">${escapeHtml(suggestion.maturityState)} · pairing confidence ${escapeHtml(suggestion.confidence)}</p>
        <ul>${suggestion.reasons.map((reason) => `<li>${escapeHtml(reason)}</li>`).join("")}</ul></li>`,
    )
    .join("");
  const noSuggestion = pairing.status === "no-suitable-wine"
    ? `<p class="warnings">No bottle cleared the suitability threshold. Best rejected candidate: ${escapeHtml(pairing.bestRejected[0]?.wine?.producer ?? "none")} — ${escapeHtml(pairing.bestRejected[0]?.wine?.cuvee ?? "")}, ${escapeHtml(pairing.bestRejected[0]?.score ?? 0)}/100.</p>`
    : "";
  return `<article class="pairing-card"><h3>${escapeHtml(pairing.dishName)}</h3>${noSuggestion}
    ${suggestions ? `<ol class="suggestions">${suggestions}</ol>` : ""}
    <div class="review">${reviewControl(`${pairing.dishId}.pairing`, "Pairing suggestions")}</div></article>`;
}

export function renderInferencePocHtml(report) {
  const sourceIndex = new Map(report.sources.map((source) => [source.id, source]));
  const wineCards = report.inferences
    .map((inference) => inferenceCard(inference, sourceIndex))
    .join("\n");
  const pairingCards = report.pairings.map(pairingCard).join("\n");
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CellarManager inference proof of concept</title>
<style>
:root{color-scheme:light;font:16px/1.45 system-ui,sans-serif;background:#f5f0ea;color:#281e1b}*{box-sizing:border-box}body{margin:0}main{max-width:1280px;margin:auto;padding:24px}h1,h2,h3{line-height:1.18}.notice,.summary,.wine-card,.pairing-card{background:#fff;border:1px solid #d8cbc2;border-radius:14px;box-shadow:0 2px 8px #3d1f1612}.notice,.summary{padding:16px;margin-bottom:18px}.summary{display:flex;gap:20px;flex-wrap:wrap}.summary span{font-weight:650}.wine-card,.pairing-card{padding:18px;margin:18px 0}.wine-card header{display:flex;justify-content:space-between;gap:16px;align-items:flex-start}.wine-card h2{margin:.35rem 0}.wine-card header p,.meta{color:#6c5b54;margin:.3rem 0}.badge{display:inline-block;border-radius:999px;padding:4px 10px;background:#e9e0d8;font-size:.85rem;font-weight:700}.state-ready,.state-priority{background:#dcebdc}.state-late,.state-assess-now{background:#f5d5ce}.state-hold{background:#e1e6f1}.confidence{white-space:nowrap;color:#6c5b54}.recommendation{margin:16px 0;padding:14px;border-left:5px solid #722236;background:#f7edf0}.ranges{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.ranges span{padding:12px;background:#f6f2ee;border-radius:10px;font-weight:700}.ranges small{display:block;color:#6c5b54;font-weight:500}.columns{display:grid;grid-template-columns:1fr 1fr;gap:18px}.columns section{min-width:0}.warnings{padding:12px 16px;color:#8b2d23;background:#fff0ec;border-radius:9px}.sources a{color:#722236}.review{display:grid;grid-template-columns:1fr 2fr;gap:12px;border-top:1px solid #e4d9d2;margin-top:16px;padding-top:14px}label{font-weight:650}select,textarea{display:block;width:100%;margin-top:5px;padding:9px;border:1px solid #b8aaa1;border-radius:8px;background:#fff;font:inherit}.pairings{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:16px}.pairing-card{margin:0;min-width:0}.suggestions{padding-left:1.4rem}.suggestions>li{margin-bottom:16px}.suggestions ul{padding-left:1.2rem}.score{float:right;border-radius:999px;background:#eee5df;padding:2px 8px}button{position:sticky;bottom:16px;padding:12px 18px;border:0;border-radius:999px;background:#722236;color:#fff;font:700 16px system-ui;box-shadow:0 3px 12px #0003;cursor:pointer}@media(max-width:800px){main{padding:12px}.wine-card header{display:block}.confidence{display:block;margin-top:8px}.ranges,.columns,.review,.pairings{grid-template-columns:1fr}.score{float:none;margin-left:6px}}
</style></head><body><main>
<h1>CellarManager 0.4.5 — maturity and pairing proof of concept</h1>
<p class="notice"><strong>Private experimental report.</strong> Nothing here is written to the CellarManager database. Ranges are explainable hypotheses assembled from place, vintage, producer, cuvée and owner evidence—not critic claims or guarantees. Please judge usefulness and direction, not exact-year precision.</p>
<div class="summary"><span>${escapeHtml(report.summary.inferred)}/${escapeHtml(report.summary.wines)} wines inferred</span><span>${escapeHtml(report.summary.highConfidence)} high · ${escapeHtml(report.summary.mediumConfidence)} medium · ${escapeHtml(report.summary.lowConfidence)} low confidence</span><span>${escapeHtml(report.summary.dishesWithSuggestions)}/${escapeHtml(report.summary.dishes)} dishes with suggestions</span><span>${escapeHtml(report.summary.sourceCount)} evidence sources used</span></div>
<h2>1. Maturity and storage</h2>${wineCards}
<h2>2. Pairing scenarios</h2><div class="pairings">${pairingCards}</div>
<button id="export" type="button">Export my validation</button>
</main><script>
document.getElementById("export").addEventListener("click",()=>{const review={schemaVersion:1,reviewedAt:new Date().toISOString(),answers:{}};document.querySelectorAll("[data-review]").forEach((element)=>{review.answers[element.dataset.review]=element.value});const blob=new Blob([JSON.stringify(review,null,2)+"\\n"],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="cellarmanager-inference-poc-validation.json";link.click();URL.revokeObjectURL(link.href)});
</script></body></html>`;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const [sample, knowledge] = await Promise.all([
    readFile(options.sample, "utf8").then((text) =>
      validatePocSample(JSON.parse(text)),
    ),
    loadKnowledge(options.knowledge),
  ]);
  const report = runInferencePoc(sample, knowledge);
  await writeFile(options.output, renderInferencePocHtml(report), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(options.output, 0o600);
  console.log(
    `Private inference POC written to ${options.output} (${report.summary.inferred}/${report.summary.wines} wines, ${report.summary.dishesWithSuggestions}/${report.summary.dishes} dishes).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
