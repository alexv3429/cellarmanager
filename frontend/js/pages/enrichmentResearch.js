import * as api from "../api.js";
import { clear, el } from "../dom.js";
import { t } from "../i18n.js";

import {
  manualChatGPTButtonLabel,
  openManualChatGPTResearch,
} from "./manualChatGPTResearch.js";

const TOPICS = [
  "drinking_window",
  "market_value",
  "pairing",
  "serving",
  "composition",
  "reviews",
  "identifiers",
];

export function apiErrorMessage(error, fallback = t("common.error_generic")) {
  const detail = error?.detail;
  if (typeof detail === "string") return detail;
  if (detail && typeof detail.message === "string") return detail.message;
  if (typeof error?.message === "string") return error.message;
  return fallback;
}

function confidenceBadge(confidence) {
  const percentage = Math.round((confidence || 0) * 100);
  const level = percentage >= 80 ? "high" : percentage >= 55 ? "medium" : "low";
  return el("span", {
    class: `confidence-badge confidence-${level}`,
    text: t("research.confidence", { pct: percentage }),
  });
}

function formatValue(candidate) {
  const value = candidate.value;
  if (candidate.topic === "drinking_window") {
    return t("research.window_value", {
      after: value.drink_after_year ?? "?",
      before: value.drink_before_year ?? "?",
    });
  }
  if (candidate.topic === "market_value") {
    return `${value.amount ?? "?"} ${value.currency || ""} (${value.low ?? "?"}–${value.high ?? "?"})`;
  }
  if (candidate.topic === "pairing") {
    return value.map((item) => item.dish).filter(Boolean).join("; ");
  }
  if (candidate.topic === "serving") {
    const parts = [];
    if (value.temperature_min_c != null || value.temperature_max_c != null) {
      parts.push(`${value.temperature_min_c ?? "?"}–${value.temperature_max_c ?? "?"} °C`);
    }
    if (value.decant_minutes != null) parts.push(`${value.decant_minutes} min`);
    if (value.glass) parts.push(value.glass);
    return parts.join(" · ") || value.rationale || "—";
  }
  if (candidate.topic === "maturity") {
    return `${value.state || "unknown"}${value.readiness_score != null ? ` (${value.readiness_score}/10)` : ""}`;
  }
  if (candidate.topic === "composition") {
    const grapes = (value.grapes || []).map((g) => g.percentage == null ? g.name : `${g.name} ${g.percentage}%`);
    return grapes.join(", ") || t("research.structured_data");
  }
  if (candidate.topic === "reviews") {
    return value.map((review) => `${review.reviewer}${review.score != null ? ` ${review.score}/${review.scale || 100}` : ""}`).join("; ");
  }
  if (candidate.topic === "identifiers") {
    return value.map((item) => `${item.scheme}: ${item.value}`).join("; ");
  }
  return JSON.stringify(value);
}

function safeWebUrl(value) {
  try {
    const url = new URL(value);
    if (!["http:", "https:"].includes(url.protocol)) return null;
    if (url.username || url.password) return null;
    const host = url.hostname.toLowerCase().replace(/\.$/, "");
    if (host === "localhost" || host.endsWith(".localhost") || host.endsWith(".local")) {
      return null;
    }
    if (/^(127\.|10\.|192\.168\.|169\.254\.)/.test(host)) return null;
    const private172 = host.match(/^172\.(\d+)\./);
    if (private172 && Number(private172[1]) >= 16 && Number(private172[1]) <= 31) {
      return null;
    }
    return url.toString();
  } catch (_error) {
    return null;
  }
}

function existingValue(candidate, wine) {
  if (candidate.topic === "drinking_window" && (wine.drink_after || wine.drink_before)) {
    return `${wine.drink_after || "?"}–${wine.drink_before || "?"}`;
  }
  if (
    candidate.topic === "market_value" &&
    candidate.label === "replacement_value" &&
    wine.market_value != null
  ) {
    return String(wine.market_value);
  }
  if (candidate.topic === "pairing" && wine.advice_pairing) return wine.advice_pairing;
  if (candidate.topic === "serving" && wine.advice_experience) return wine.advice_experience;
  return null;
}

function sourceLink(source) {
  const safeUrl = safeWebUrl(source.url);
  const label = source.title || source.domain || source.url;
  const sourceNode = safeUrl
    ? el("a", {
        text: label,
        href: safeUrl,
        target: "_blank",
        rel: "noopener noreferrer",
      })
    : el("span", { text: label });
  const metadata = [source.source_type, source.publisher, source.published_at]
    .filter(Boolean)
    .join(" · ");
  return el(
    "li",
    {},
    [
      sourceNode,
      metadata
        ? el("span", { class: "source-meta", text: ` — ${metadata}` })
        : null,
    ].filter(Boolean)
  );
}

function candidateCard(candidate, sourcesById, wine, onDecision) {
  const sourceList = candidate.source_ids
    .map((id) => sourcesById[id])
    .filter(Boolean);
  const actions = el("div", { class: "research-actions" });
  if (candidate.status === "proposed") {
    actions.appendChild(el("button", {
      class: "small primary",
      text: t("research.accept"),
      onclick: () => onDecision(candidate, "accepted"),
    }));
    actions.appendChild(el("button", {
      class: "small",
      text: t("research.reject"),
      onclick: () => onDecision(candidate, "rejected"),
    }));
  } else {
    actions.appendChild(el("span", {
      class: candidate.status === "accepted" ? "success-note" : "hint",
      text: t(`research.status_${candidate.status}`),
    }));
  }
  return el("article", { class: "research-candidate" }, [
    el("div", { class: "research-candidate-heading" }, [
      el("h4", { text: t(`research.label_${candidate.label}`) || candidate.label }),
      confidenceBadge(candidate.confidence),
    ]),
    el("p", { class: "research-value", text: formatValue(candidate) }),
    existingValue(candidate, wine)
      ? el("p", {
          class: "research-existing",
          text: t("research.existing_value", { value: existingValue(candidate, wine) }),
        })
      : null,
    el("p", { class: "hint", text: candidate.rationale || candidate.method }),
    el("p", { class: "hint", text: t("research.method", { method: candidate.method }) }),
    sourceList.length
      ? el("details", {}, [
          el("summary", { text: t("research.sources_count", { count: sourceList.length }) }),
          el("ul", { class: "research-sources" }, sourceList.map(sourceLink)),
        ])
      : el("p", { class: "hint", text: t("research.inferred_no_source") }),
    actions,
  ].filter(Boolean));
}

function renderJob(body, job, wine, refresh, onApplied = () => {}) {
  clear(body);
  if (job.status === "queued" || job.status === "running") {
    body.appendChild(el("p", { class: "research-progress", text: t(`research.${job.status}`) }));
    return;
  }
  if (job.status === "failed") {
    body.appendChild(el("p", {
      class: "form-error",
      text: job.error_message || t("research.failed"),
    }));
    return;
  }

  body.appendChild(el("p", { class: "research-summary", text: job.summary || t("research.completed") }));
  if (job.usage?.total_tokens) {
    body.appendChild(el("p", {
      class: "hint",
      text: t("research.token_usage", { count: job.usage.total_tokens }),
    }));
  }

  const sourcesById = Object.fromEntries((job.sources || []).map((source) => [source.id, source]));
  const candidates = job.candidates || [];
  if (!candidates.length) {
    body.appendChild(el("p", { class: "empty-state", text: t("research.no_candidates") }));
    return;
  }

  const onDecision = async (candidate, decision) => {
    if (
      decision === "accepted" &&
      existingValue(candidate, wine) &&
      !window.confirm(t("research.replace_confirm"))
    ) {
      return;
    }
    try {
      await api.post(`/enrichment/candidates/${candidate.id}/decision`, {
        decision,
        // This button is an explicit user decision, so replacing an existing
        // manual value is intentional rather than an automatic overwrite.
        force: decision === "accepted",
      });
      if (decision === "accepted") onApplied();
      await refresh();
    } catch (error) {
      body.prepend(el("p", { class: "form-error", text: apiErrorMessage(error) }));
    }
  };
  for (const candidate of candidates) {
    body.appendChild(candidateCard(candidate, sourcesById, wine, onDecision));
  }

  if ((job.market_observations || []).length) {
    body.appendChild(el("details", { class: "market-observations" }, [
      el("summary", { text: t("research.market_observations", { count: job.market_observations.length }) }),
      el("ul", {}, job.market_observations.map((observation) => el("li", {
        text: `${observation.amount} ${observation.currency} / ${observation.bottle_count} — ${observation.offer_type}${observation.exact_match ? "" : ` — ${t("research.not_exact_match")}`}${observation.in_stock === false ? ` — ${t("research.out_of_stock")}` : ""}`,
      }))),
    ]));
  }
}

async function pollJob(jobId, body, wine, onApplied) {
  let stopped = false;
  async function refresh() {
    if (stopped) return;
    const job = await api.get(`/enrichment/jobs/${jobId}`);
    renderJob(body, job, wine, refresh, onApplied);
    if (job.status === "queued" || job.status === "running") {
      window.setTimeout(refresh, 1200);
    }
  }
  await refresh();
  return () => { stopped = true; };
}

export async function openWineResearchDialog(wine, onApplied = () => {}) {
  const overlay = el("div", { class: "modal-overlay" });
  const body = el("div", { class: "research-body" });
  const closeBtn = el("button", {
    type: "button",
    text: t("common.close"),
    onclick: () => overlay.remove(),
  });
  const modal = el("div", { class: "modal research-modal" }, [
    el("h3", { text: t("research.title", { wine: `${wine.producer}${wine.cuvee ? ` — ${wine.cuvee}` : ""}` }) }),
    body,
    el("div", { class: "modal-actions" }, [closeBtn]),
  ]);
  overlay.appendChild(modal);
  document.body.appendChild(overlay);

  clear(body);
  body.appendChild(el("p", { text: t("research.loading_status") }));
  let status;
  try {
    status = await api.get("/enrichment/status");
  } catch (error) {
    clear(body);
    body.appendChild(el("p", { class: "form-error", text: apiErrorMessage(error) }));
    return;
  }
  clear(body);
  if (!status.configured && !status.manual_available) {
    body.appendChild(el("p", { class: "empty-state", text: status.message }));
    body.appendChild(el("p", { class: "hint", text: t("research.configure_hint") }));
    return;
  }

  if (status.configured) {
    body.appendChild(el("p", {
      class: "hint",
      text: t("research.provider_status", {
        provider: status.provider,
        model: status.model,
        jobs: status.jobs_today,
        tokens: status.tokens_this_month,
      }),
    }));
  } else {
    body.appendChild(el("p", { class: "hint", text: status.message }));
  }
  body.appendChild(el("p", { class: "research-warning", text: t("research.review_warning") }));

  const topicInputs = TOPICS.map((topic) => {
    const input = el("input", { type: "checkbox", value: topic, checked: true });
    return { topic, input, row: el("label", { class: "research-topic" }, [input, el("span", { text: t(`research.topic_${topic}`) })]) };
  });
  body.appendChild(el("div", { class: "research-topics" }, topicInputs.map((item) => item.row)));

  const locale = document.documentElement.lang || "en";

  const startBtn = status.configured
    ? el("button", { class: "primary", text: t("research.start") })
    : null;

  const manualBtn = status.manual_available
    ? el("button", {
        class: "primary",
        text: manualChatGPTButtonLabel(locale),
      })
    : null;

  const historyBtn = el("button", { text: t("research.history") });

  const buttonRow = el(
    "div",
    { class: "research-actions" },
    [startBtn, manualBtn, historyBtn].filter(Boolean),
  );

  body.appendChild(buttonRow);

  if (startBtn) {
    startBtn.addEventListener("click", async () => {
      const topics = topicInputs
        .filter((item) => item.input.checked)
        .map((item) => item.topic);

      if (!topics.length) return;

      clear(body);
      body.appendChild(
        el("p", {
          class: "research-progress",
          text: t("research.starting"),
        }),
      );

      try {
        const job = await api.post(`/wines/${wine.id}/research`, {
          topics,
          locale,
          background: true,
          auto_apply: false,
        });

        await pollJob(job.id, body, wine, onApplied);
      } catch (error) {
        clear(body);
        body.appendChild(
          el("p", {
            class: "form-error",
            text: apiErrorMessage(error),
          }),
        );
      }
    });
  }

  if (manualBtn) {
    manualBtn.addEventListener("click", async () => {
      const topics = topicInputs
        .filter((item) => item.input.checked)
        .map((item) => item.topic);

      if (!topics.length) return;

      await openManualChatGPTResearch(
        body,
        wine,
        topics,
        locale,
        async (job) => {
          const refresh = async () => {
            const refreshed = await api.get(`/enrichment/jobs/${job.id}`);
            renderJob(body, refreshed, wine, refresh, onApplied);
          };

          renderJob(body, job, wine, refresh, onApplied);
        },
        apiErrorMessage,
      );
    });
  }

  
  historyBtn.addEventListener("click", async () => {
    clear(body);
    body.appendChild(el("p", { text: t("research.loading_history") }));
    try {
      const jobs = await api.get(`/wines/${wine.id}/research/history`);
      clear(body);
      if (!jobs.length) {
        body.appendChild(el("p", { class: "empty-state", text: t("research.no_history") }));
        return;
      }
      for (const job of jobs) {
        const button = el("button", {
          class: "research-history-row",
          text: `${job.created_at} — ${job.status} — ${(job.topics || []).join(", ")}`,
          onclick: async () => {
            clear(body);
            body.appendChild(el("p", { text: t("research.loading_history") }));
            try {
              const detailed = await api.get(`/enrichment/jobs/${job.id}`);
              const refresh = async () => {
                const refreshed = await api.get(`/enrichment/jobs/${job.id}`);
                renderJob(body, refreshed, wine, refresh, onApplied);
              };
              renderJob(body, detailed, wine, refresh, onApplied);
            } catch (error) {
              clear(body);
              body.appendChild(
                el("p", { class: "form-error", text: apiErrorMessage(error) })
              );
            }
          },
        });
        body.appendChild(button);
      }
    } catch (error) {
      clear(body);
      body.appendChild(el("p", { class: "form-error", text: apiErrorMessage(error) }));
    }
  });
}
