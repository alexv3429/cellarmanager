#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";

import { assertSafeOutputPath, validateSample } from "./provider_trial.mjs";

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function parseOptions(argv) {
  const options = { sample: null, grapeminds: null, wineapi: null, output: null };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--sample", "--grapeminds", "--wineapi", "--output"].includes(option)) {
      throw new Error(
        "Usage: provider_review.mjs --sample <path> --grapeminds <report> --wineapi <report> --output <html>",
      );
    }
    options[option.slice(2)] = resolve(value);
  }
  if (Object.values(options).some((value) => value === null)) {
    throw new Error("Sample, both provider reports, and output are required");
  }
  assertSafeOutputPath(options.output);
  return options;
}

function indexProvider(report, providerId) {
  const provider = report?.providers?.find((candidate) => candidate.id === providerId);
  if (!provider?.results) throw new Error(`Report does not contain ${providerId}`);
  return {
    summary: provider.summary,
    results: new Map(provider.results.map((result) => [result.sampleId, result])),
  };
}

function identityBadge(result) {
  if (result?.identityEvidence?.hardBlockers?.length > 0) {
    return `Blocked: ${result.identityEvidence.hardBlockers.join(", ")}`;
  }
  if (result?.candidate?.exactLwin7 === true) return "LWIN exact";
  if (result?.candidate?.exactLwin7 === false) return "LWIN conflict";
  return "Identity unverified";
}

function candidateMarkup(result) {
  const candidate = result?.candidate;
  if (!candidate) return '<p class="missing">No candidate</p>';
  const evidence = result.identityEvidence;
  const evidenceMarkup = evidence
    ? `<p class="meta">Colour: ${escapeHtml(evidence.sourceColour ?? "unknown")} → ${escapeHtml(evidence.providerColour ?? "not supplied")} (${escapeHtml(evidence.colourStatus)})<br>Vintage: ${escapeHtml(evidence.sourceVintage ?? "NV")} → ${escapeHtml(evidence.providerVintage ?? "not supplied")} (${escapeHtml(evidence.vintageStatus)})<br>Maximum scope: ${escapeHtml(evidence.eligibleScope)}</p>`
    : "";
  return `<p><strong>${escapeHtml(candidate.name ?? "Unnamed candidate")}</strong></p>
    <p>${escapeHtml(candidate.producer ?? "Producer unavailable")}</p>
    <p class="meta">${escapeHtml(identityBadge(result))}${candidate.lwin7 ? ` · LWIN ${escapeHtml(candidate.lwin7)}` : ""}</p>${evidenceMarkup}`;
}

function reviewSelect(name, label, values) {
  const options = values
    .map(([value, text]) => `<option value="${escapeHtml(value)}">${escapeHtml(text)}</option>`)
    .join("");
  return `<label>${escapeHtml(label)}<select data-review="${escapeHtml(name)}"><option value="">Choose…</option>${options}</select></label>`;
}

export function renderReviewHtml(sampleInput, grapemindsReport, wineApiReport) {
  const sample = validateSample(sampleInput);
  const grapeminds = indexProvider(grapemindsReport, "grapeminds");
  const wineapi = indexProvider(wineApiReport, "wineapi");
  const rows = sample.wines
    .map((wine) => {
      const grape = grapeminds.results.get(wine.sampleId);
      const wineResult = wineapi.results.get(wine.sampleId);
      if (!grape || !wineResult) {
        throw new Error(`Provider report does not contain ${wine.sampleId}`);
      }
      const window = grape.drinkingWindow ?? {};
      const apiPeriod =
        window.from !== null && window.from !== undefined && window.to !== null && window.to !== undefined
          ? `${window.from}–${window.to}`
          : "Unavailable";
      const pairings = (wineResult.pairing?.items ?? [])
        .map((item) => `<li>${escapeHtml(item.food ?? "Unnamed pairing")}${item.notes ? ` — ${escapeHtml(item.notes)}` : ""}</li>`)
        .join("");
      const identityOptions = [
        ["exact", "Exact wine"],
        ["fallback", "Useful fallback only"],
        ["wrong", "Wrong wine"],
        ["unsure", "Unsure"],
      ];
      const adviceOptions = [
        ["useful", "Useful"],
        ["questionable", "Questionable"],
        ["unusable", "Unusable"],
      ];
      return `<article class="wine-card">
        <header><span>${escapeHtml(wine.sampleId)}</span><h2>${escapeHtml(wine.producer)} — ${escapeHtml(wine.cuvee)}</h2>
        <p>${escapeHtml(wine.vintage ?? "NV")} · ${escapeHtml(wine.appellation ?? "No appellation")}${wine.lwin7 ? ` · expected LWIN ${escapeHtml(wine.lwin7)}` : ""}</p></header>
        <section><h3>Grapeminds identity</h3>${candidateMarkup(grape)}${reviewSelect(`${wine.sampleId}.grapemindsIdentity`, "Your verdict", identityOptions)}</section>
        <section><h3>Drinking window</h3><p class="meta">API period: ${escapeHtml(apiPeriod)} (provider semantics require confirmation)</p><p>${escapeHtml(window.statement ?? "No statement")}</p>${reviewSelect(`${wine.sampleId}.drinkingWindow`, "Advice quality", adviceOptions)}</section>
        <section><h3>WineAPI identity</h3>${candidateMarkup(wineResult)}${reviewSelect(`${wine.sampleId}.wineapiIdentity`, "Your verdict", identityOptions)}</section>
        <section><h3>Food pairings</h3>${pairings ? `<ul>${pairings}</ul>` : '<p class="missing">No pairing returned</p>'}${reviewSelect(`${wine.sampleId}.pairing`, "Advice quality", adviceOptions)}</section>
      </article>`;
    })
    .join("\n");

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>CellarManager provider trial review</title>
<style>
:root{color-scheme:light;font:16px/1.45 system-ui,sans-serif;background:#f6f1eb;color:#271d1b}body{margin:0}main{max-width:1500px;margin:auto;padding:24px}.notice,.summary,.wine-card{background:#fff;border:1px solid #d9ccc2;border-radius:14px;box-shadow:0 2px 8px #3d1f1612}.notice,.summary{padding:16px;margin-bottom:18px}.summary{display:flex;gap:24px;flex-wrap:wrap}.wine-card{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));overflow:hidden;margin:18px 0}.wine-card header{grid-column:1/-1;background:#efe6df;padding:16px}.wine-card header h2{margin:.2rem 0}.wine-card header p,.meta{color:#6c5b54;margin:.3rem 0}.wine-card section{padding:16px;border-right:1px solid #e6dcd5}.wine-card section:last-child{border:0}h1,h2,h3{line-height:1.2}h3{margin-top:0}label{display:block;font-weight:600;margin-top:16px}select{display:block;width:100%;margin-top:6px;padding:9px;border:1px solid #b8aaa1;border-radius:8px;background:#fff;font:inherit}.missing{color:#9a3429}button{position:sticky;bottom:16px;padding:12px 18px;border:0;border-radius:999px;background:#6f1d2c;color:#fff;font:600 16px system-ui;box-shadow:0 3px 12px #0003;cursor:pointer}@media(max-width:900px){main{padding:12px}.wine-card{grid-template-columns:1fr}.wine-card header{grid-column:1}.wine-card section{border-right:0;border-bottom:1px solid #e6dcd5}}
</style></head><body><main>
<h1>CellarManager 0.4.5 — private provider review</h1>
<p class="notice"><strong>Private trial data.</strong> Do not publish or commit this page. Provider candidates are suggestions, never confirmed identities. Grapeminds period numbers are shown exactly as returned because their unit/anchor still requires written confirmation.</p>
<div class="summary"><span>Grapeminds: ${escapeHtml(grapeminds.summary.drinkingWindows)}/${sample.wines.length} windows, ${escapeHtml(grapeminds.summary.pairings)}/${sample.wines.length} pairings</span><span>WineAPI: ${escapeHtml(wineapi.summary.pairings)}/${sample.wines.length} pairings</span><span>${sample.wines.length} wines to review</span></div>
${rows}
<button id="export" type="button">Export my validation</button>
</main><script>
document.getElementById("export").addEventListener("click",()=>{const review={schemaVersion:1,reviewedAt:new Date().toISOString(),answers:{}};document.querySelectorAll("[data-review]").forEach((element)=>{review.answers[element.dataset.review]=element.value});const blob=new Blob([JSON.stringify(review,null,2)+"\\n"],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="cellarmanager-provider-validation.json";link.click();URL.revokeObjectURL(link.href)});
</script></body></html>`;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const [sample, grapeminds, wineapi] = await Promise.all(
    [options.sample, options.grapeminds, options.wineapi].map(async (path) =>
      JSON.parse(await readFile(path, "utf8")),
    ),
  );
  await writeFile(options.output, renderReviewHtml(sample, grapeminds, wineapi), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(options.output, 0o600);
  console.log(`Private review written to ${options.output}`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
