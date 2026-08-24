#!/usr/bin/env node

import { chmod, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

import {
  defaultKnowledgePath,
  loadMaturityKnowledge,
  normalizeWineText,
} from "./maturity_knowledge_v2.mjs";
import { assertSafeOutputPath } from "./provider_trial.mjs";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));

function canonicalColor(value) {
  const color = normalizeWineText(value);
  if (["red", "rouge"].includes(color)) return "red";
  if (["white", "blanc"].includes(color)) return "white";
  if (["rose", "pink"].includes(color)) return "rose";
  if (["sparkling", "effervescent", "champagne"].includes(color)) {
    return "sparkling";
  }
  if (["sweet", "doux", "liquoreux"].includes(color)) return "sweet";
  if (["fortified", "fortifie"].includes(color)) return "fortified";
  return "other";
}

function stateFromYears(asOfYear, years) {
  if (asOfYear < years.firstTrial) return "hold";
  if (asOfYear < years.bestStart) return "assess";
  if (asOfYear <= years.bestEnd) return "ready";
  if (asOfYear <= years.outer) return "priority";
  return "assess-now";
}

function stateLabel(state) {
  return {
    "assess-now": "Assess now",
    assess: "Start assessing",
    hold: "Keep aging",
    priority: "Drink sooner",
    ready: "Likely ready",
  }[state];
}

export function inferMaturityV2(knowledge, wine, asOfYear = 2026) {
  if (!Number.isInteger(wine.vintage)) {
    return { reason: "missing-vintage", status: "needs-review", wine };
  }

  const placeIndex = new Map(knowledge.places.map((place) => [place.id, place]));
  const archetypeIndex = new Map(
    knowledge.archetypes.map((archetype) => [archetype.id, archetype]),
  );
  const aliasIndex = new Map();
  for (const place of knowledge.places) {
    for (const alias of place.aliases) {
      aliasIndex.set(normalizeWineText(alias), place.id);
    }
  }
  const vintageIndex = new Map(
    knowledge.vintageProfiles.map((vintage) => [
      `${vintage.place}:${vintage.color}:${vintage.vintage}`,
      vintage,
    ]),
  );

  const color = canonicalColor(wine.color);
  const placeId = aliasIndex.get(normalizeWineText(wine.appellation));
  if (!placeId) {
    return { reason: "unsupported-place-profile", status: "needs-review", wine };
  }
  const place = placeIndex.get(placeId);
  const archetypeId = place.profiles[color];
  if (!archetypeId) {
    return { reason: "appellation-color-conflict", status: "needs-review", wine };
  }
  const archetype = archetypeIndex.get(archetypeId);

  let vintage = null;
  let vintagePlace = place;
  while (vintagePlace) {
    vintage = vintageIndex.get(
      `${vintagePlace.id}:${color}:${wine.vintage}`,
    );
    if (vintage) break;
    vintagePlace = vintagePlace.parent
      ? placeIndex.get(vintagePlace.parent)
      : null;
  }

  const firstAge = Math.max(0, archetype.first + (vintage?.opening ?? 0));
  const bestStartAge = Math.max(
    firstAge,
    archetype.bestStart + (vintage?.opening ?? 0),
  );
  const bestEndAge = Math.max(
    bestStartAge,
    archetype.bestEnd + (vintage?.longevity ?? 0),
  );
  const outerAge = Math.max(
    bestEndAge,
    archetype.outer + (vintage?.longevity ?? 0),
  );
  const years = {
    bestEnd: wine.vintage + bestEndAge,
    bestStart: wine.vintage + bestStartAge,
    firstTrial: wine.vintage + firstAge,
    outer: wine.vintage + outerAge,
  };
  const confidence = Number(
    (
      archetype.confidence * 0.55 +
      (vintage?.confidence ?? 0) * 0.25
    ).toFixed(3),
  );
  const state = stateFromYears(asOfYear, years);

  return {
    archetype,
    color,
    confidence,
    confidenceLabel:
      confidence >= 0.75 ? "high" : confidence >= 0.5 ? "medium" : "low",
    place,
    state,
    stateLabel: stateLabel(state),
    status: "projected",
    vintage,
    wine,
    years,
  };
}

function groupKey(result) {
  return result.status === "projected"
    ? `${result.place.id}:${result.color}`
    : `unresolved:${result.reason}`;
}

export function buildMaturityV2Preview(knowledge, wines, asOfYear = 2026) {
  if (!Array.isArray(wines)) throw new Error("Preview wines must be an array");
  const results = wines.map((wine) => inferMaturityV2(knowledge, wine, asOfYear));
  const groups = new Map();
  for (const result of results.filter((item) => item.status === "projected")) {
    const key = groupKey(result);
    const group = groups.get(key) ?? {
      appellation: result.place.name,
      area: result.wine.area,
      bottles: 0,
      color: result.color,
      results: [],
      wines: 0,
    };
    group.wines += 1;
    group.bottles += Number(result.wine.quantity ?? 0);
    group.results.push(result);
    groups.set(key, group);
  }

  const sortedGroups = [...groups.values()].sort(
    (left, right) => right.bottles - left.bottles || left.appellation.localeCompare(right.appellation),
  );
  const representative = [];
  for (const [index, group] of sortedGroups.entries()) {
    if (index >= 36) break;
    const sorted = [...group.results].sort(
      (left, right) =>
        left.wine.vintage - right.wine.vintage ||
        Number(right.wine.quantity ?? 0) - Number(left.wine.quantity ?? 0),
    );
    representative.push(sorted[0]);
    if (index < 12 && sorted.at(-1) !== sorted[0]) {
      representative.push(sorted.at(-1));
    }
  }

  const unresolved = results.filter((result) => result.status !== "projected");
  return {
    asOfYear,
    groups: sortedGroups,
    representative,
    results,
    summary: {
      bottles: wines.reduce((sum, wine) => sum + Number(wine.quantity ?? 0), 0),
      placeColorGroups: groups.size,
      projected: results.length - unresolved.length,
      projectedBottles: results
        .filter((result) => result.status === "projected")
        .reduce((sum, result) => sum + Number(result.wine.quantity ?? 0), 0),
      representative: representative.length,
      unresolved: unresolved.length,
      unresolvedBottles: unresolved.reduce(
        (sum, result) => sum + Number(result.wine.quantity ?? 0),
        0,
      ),
      wines: wines.length,
    },
    unresolved,
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function reasonLabel(reason) {
  return {
    "appellation-color-conflict": "Check appellation or colour",
    "missing-vintage": "Missing vintage",
    "unsupported-place-profile": "No exact reviewed profile",
  }[reason] ?? reason;
}

function reviewControl(key) {
  return `<label>Assessment
    <select data-review="${escapeHtml(key)}.verdict"><option value="">Choose…</option>
      <option value="useful">Useful</option><option value="questionable">Questionable</option>
      <option value="wrong">Wrong</option><option value="unsure">Unsure</option>
    </select></label><label>Optional note
      <textarea data-review="${escapeHtml(key)}.notes" rows="2" placeholder="What should change?"></textarea>
    </label>`;
}

export function renderMaturityV2Preview(report) {
  const sampleMetadata = JSON.stringify(
    report.representative.map((result, index) => ({
      appellation: result.wine.appellation,
      color: result.wine.color,
      cuvee: result.wine.cuvee,
      id: `sample-${index + 1}`,
      producer: result.wine.producer,
      vintage: result.wine.vintage,
    })),
  ).replaceAll("<", "\\u003c");
  const cards = report.representative.map((result, index) => {
    const vintageReason = result.vintage
      ? `<li>${escapeHtml(result.vintage.rationale)}</li>`
      : "<li>No reviewed local vintage modifier; the exact place baseline is unchanged.</li>";
    return `<article class="wine-card" data-search="${escapeHtml(`${result.wine.producer} ${result.wine.cuvee} ${result.wine.appellation} ${result.wine.area} ${result.wine.vintage}`.toLowerCase())}">
      <header><div><span class="badge state-${escapeHtml(result.state)}">${escapeHtml(result.stateLabel)}</span>
        <h2>${escapeHtml(result.wine.producer)} — ${escapeHtml(result.wine.cuvee)}</h2>
        <p>${escapeHtml(result.wine.vintage)} · ${escapeHtml(result.wine.appellation)} · ${escapeHtml(result.wine.color)} · ${escapeHtml(result.wine.quantity)} bottle${result.wine.quantity === 1 ? "" : "s"}</p></div>
        <span class="confidence">${Math.round(result.confidence * 100)}% · ${escapeHtml(result.confidenceLabel)}</span></header>
      <div class="ranges"><span><small>First assessment</small>${result.years.firstTrial}</span>
        <span><small>Likely best</small>${result.years.bestStart}–${result.years.bestEnd}</span>
        <span><small>Preferably drink by</small>${result.years.outer}</span></div>
      <details><summary>Why this range?</summary><ul><li>${escapeHtml(result.archetype.rationale)}</li>${vintageReason}</ul></details>
      ${reviewControl(`sample-${index + 1}`)}
    </article>`;
  }).join("\n");
  const groupRows = report.groups.map((group) => `<tr><td>${escapeHtml(group.appellation)}</td><td>${escapeHtml(group.color)}</td><td>${group.wines}</td><td>${group.bottles}</td></tr>`).join("");
  const unresolvedRows = report.unresolved.map((result) => `<tr><td>${escapeHtml(result.wine.producer)} — ${escapeHtml(result.wine.cuvee)}</td><td>${escapeHtml(result.wine.vintage ?? "NV")}</td><td>${escapeHtml(result.wine.appellation ?? "—")}</td><td>${escapeHtml(result.wine.color)}</td><td>${escapeHtml(reasonLabel(result.reason))}</td></tr>`).join("");

  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>CellarManager maturity knowledge v2 review</title><style>
:root{font:16px/1.45 system-ui,sans-serif;color:#2b201d;background:#f4efea}*{box-sizing:border-box}body{margin:0}main{max-width:1180px;margin:auto;padding:20px}.notice,.summary,.wine-card,details.coverage{background:#fff;border:1px solid #d9ccc3;border-radius:14px}.notice,details.coverage{padding:16px;margin:14px 0}.summary{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));gap:1px;overflow:hidden;margin:16px 0}.summary span{padding:14px;background:#fff}.summary strong{display:block;font-size:1.35rem}.toolbar{position:sticky;top:0;z-index:2;padding:10px 0;background:#f4efeae8;backdrop-filter:blur(8px)}input,select,textarea,button{font:inherit;padding:9px 11px;border:1px solid #b8aaa1;border-radius:8px;background:#fff}.toolbar input{width:min(100%,420px)}.cards{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.wine-card{padding:16px;min-width:0}.wine-card header{display:flex;justify-content:space-between;gap:10px}.wine-card h2{font-size:1.05rem;margin:.4rem 0}.wine-card p{color:#6d5b54;margin:.25rem 0}.badge{display:inline-block;padding:3px 8px;border-radius:999px;background:#e7dfd9;font-size:.8rem;font-weight:700}.state-ready,.state-priority{background:#dfeadb}.state-hold{background:#e0e5ef}.state-assess-now{background:#f3d8d1}.confidence{white-space:nowrap;color:#6d5b54;font-size:.85rem}.ranges{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:7px;margin:12px 0}.ranges span{padding:9px;background:#f6f2ef;border-radius:8px;font-weight:700}.ranges small{display:block;color:#6d5b54;font-weight:500}label{display:block;margin-top:10px;font-weight:650}label select,label textarea{display:block;width:100%;margin-top:4px}table{width:100%;border-collapse:collapse;margin-top:10px}th,td{text-align:left;padding:7px;border-bottom:1px solid #e4d9d2}button{margin-top:16px;background:#722236;color:#fff;font-weight:700;cursor:pointer}@media(max-width:720px){main{padding:10px}.summary,.cards{grid-template-columns:1fr}.wine-card header{display:block}.ranges{grid-template-columns:1fr 1fr}.confidence{display:block;margin-top:5px}table{font-size:.85rem}.coverage{overflow-x:auto}}
</style></head><body><main><h1>Maturity library v2 — private validation</h1>
<p class="notice"><strong>No production data is changed.</strong> This page applies the candidate exact-appellation model locally to wines that v1 could not assess. Review direction and broad horizon, not false precision. The sample includes the oldest and newest examples from high-volume profiles; the full aggregate coverage remains below.</p>
<div class="summary"><span><strong>${report.summary.projected}/${report.summary.wines}</strong>newly projected</span><span><strong>${report.summary.projectedBottles}/${report.summary.bottles}</strong>bottles covered</span><span><strong>${report.summary.placeColorGroups}</strong>place/colour groups</span><span><strong>${report.summary.unresolved}</strong>still unresolved</span></div>
<div class="toolbar"><input id="search" type="search" placeholder="Filter the validation sample…"></div>
<h2>Representative results (${report.summary.representative})</h2><section class="cards">${cards}</section>
<details class="coverage"><summary>Full newly covered group counts</summary><table><thead><tr><th>Appellation</th><th>Colour</th><th>Wines</th><th>Bottles</th></tr></thead><tbody>${groupRows}</tbody></table></details>
<details class="coverage" open><summary>Still unresolved (${report.summary.unresolved})</summary><table><thead><tr><th>Wine</th><th>Vintage</th><th>Appellation</th><th>Colour</th><th>Reason</th></tr></thead><tbody>${unresolvedRows}</tbody></table></details>
<button id="export" type="button">Export my validation</button></main><script>
const samples=${sampleMetadata};const search=document.getElementById("search");search.addEventListener("input",()=>{const value=search.value.trim().toLowerCase();document.querySelectorAll(".wine-card").forEach(card=>card.hidden=value&&!card.dataset.search.includes(value))});
document.getElementById("export").addEventListener("click",()=>{const review={schemaVersion:1,knowledgeVersion:2,reviewedAt:new Date().toISOString(),samples,answers:{}};document.querySelectorAll("[data-review]").forEach(element=>{review.answers[element.dataset.review]=element.value});const blob=new Blob([JSON.stringify(review,null,2)+"\\n"],{type:"application/json"});const link=document.createElement("a");link.href=URL.createObjectURL(blob);link.download="cellarmanager-maturity-v2-validation.json";link.click();URL.revokeObjectURL(link.href)});
</script></body></html>`;
}

function parseOptions(argv) {
  const options = { knowledge: defaultKnowledgePath, output: null, sample: null };
  for (let index = 0; index < argv.length; index += 2) {
    const option = argv[index];
    const value = argv[index + 1];
    if (!value || !["--knowledge", "--output", "--sample"].includes(option)) {
      throw new Error(
        "Usage: maturity_v2_preview.mjs --sample <private-json> [--knowledge <json>] --output <private-html>",
      );
    }
    options[option.slice(2)] = resolve(value);
  }
  if (!options.sample || !options.output) throw new Error("Sample and output are required");
  assertSafeOutputPath(options.output);
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const [knowledge, wines] = await Promise.all([
    loadMaturityKnowledge(options.knowledge),
    readFile(options.sample, "utf8").then(JSON.parse),
  ]);
  const report = buildMaturityV2Preview(knowledge, wines);
  await writeFile(options.output, renderMaturityV2Preview(report), {
    encoding: "utf8",
    mode: 0o600,
  });
  await chmod(options.output, 0o600);
  console.log(
    `Private maturity v2 preview written to ${options.output} (${report.summary.projected}/${report.summary.wines} projected, ${report.summary.unresolved} unresolved).`,
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
