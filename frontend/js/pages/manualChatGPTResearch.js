import * as api from "../api.js";
import { clear, el } from "../dom.js";

const COPY = {
  en: {
    button: "Prepare for ChatGPT",
    preparing: "Preparing the ChatGPT request…",
    intro:
      "Copy this prompt into ChatGPT. Ask it to browse the web, then paste the JSON response below.",
    prompt: "Prompt for ChatGPT",
    copy: "Copy prompt",
    copied: "Prompt copied",
    response: "ChatGPT JSON response",
    responsePlaceholder: "Paste the complete JSON object returned by ChatGPT…",
    import: "Import and validate",
    importing: "Validating and importing the response…",
    empty: "Paste the ChatGPT JSON response before importing it.",
    copyFailed: "Could not copy automatically. Select the prompt and copy it manually.",
    formatTitle: "Before importing",
    formatRules: [
      'Use only normal double quotes (") for JSON keys and string delimiters.',
      "Paste one complete JSON object, optionally inside a ```json code block.",
      "Dates must be YYYY-MM-DD, a complete ISO-8601 datetime, or null — never YYYY-MM.",
      "Do not add comments, trailing commas, ellipses, or prose outside the JSON.",
    ],
    invalidJson: "The pasted response is not valid JSON. Copy the JSON code block directly from ChatGPT.",
    smartQuotes:
      'The pasted response uses typographic quotes (“ ”). Replace them with normal double quotes (").',
    monthOnlyDates:
      "Month-only dates are not accepted. Use a complete YYYY-MM-DD date or null for: {paths}",

  },
  fr: {
    button: "Préparer pour ChatGPT",
    preparing: "Préparation de la demande pour ChatGPT…",
    intro:
      "Copiez cette consigne dans ChatGPT. Demandez-lui de consulter le web, puis collez ci-dessous la réponse JSON.",
    prompt: "Consigne pour ChatGPT",
    copy: "Copier la consigne",
    copied: "Consigne copiée",
    response: "Réponse JSON de ChatGPT",
    responsePlaceholder: "Collez l’objet JSON complet renvoyé par ChatGPT…",
    import: "Importer et valider",
    importing: "Validation et import de la réponse…",
    empty: "Collez la réponse JSON de ChatGPT avant de l’importer.",
    copyFailed:
      "La copie automatique a échoué. Sélectionnez la consigne et copiez-la manuellement.",
    formatTitle: "Avant l’import",
    formatRules: [
      'Utilisez uniquement des guillemets doubles droits (") pour les clés et chaînes JSON.',
      "Collez un objet JSON complet, éventuellement dans un bloc ```json.",
      "Les dates doivent être au format YYYY-MM-DD, une date-heure ISO-8601 complète ou null — jamais YYYY-MM.",
      "N’ajoutez ni commentaires, ni virgules finales, ni points de suspension, ni texte hors du JSON.",
    ],
    invalidJson:
      "La réponse collée n’est pas un JSON valide. Copiez directement le bloc de code JSON depuis ChatGPT.",
    smartQuotes:
      'La réponse utilise des guillemets typographiques (“ ”). Remplacez-les par des guillemets doubles droits (").',
    monthOnlyDates:
      "Les dates réduites au mois ne sont pas acceptées. Utilisez YYYY-MM-DD ou null pour : {paths}",

  },
};

function messages(locale) {
  return COPY[(locale || "en").toLowerCase().split("-")[0]] || COPY.en;
}

export function manualChatGPTButtonLabel(locale) {
  return messages(locale).button;
}



function stripJsonFence(raw) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  return match ? match[1].trim() : trimmed;
}

function monthOnlyDatePaths(value, path = "response", found = []) {
  if (Array.isArray(value)) {
    value.forEach((item, index) => monthOnlyDatePaths(item, `${path}[${index}]`, found));
    return found;
  }
  if (!value || typeof value !== "object") return found;

  for (const [key, child] of Object.entries(value)) {
    const childPath = `${path}.${key}`;
    if (
      ["published_at", "observed_at", "review_date"].includes(key) &&
      typeof child === "string" &&
      /^\d{4}-\d{2}$/.test(child)
    ) {
      found.push(childPath);
    } else {
      monthOnlyDatePaths(child, childPath, found);
    }
  }
  return found;
}

export function parseManualChatGPTResponse(raw, locale = "en") {
  const message = messages(locale);
  const cleaned = stripJsonFence(raw);
  let parsed;
  try {
    parsed = JSON.parse(cleaned);
  } catch (error) {
    if (/[“”]/.test(cleaned)) throw new Error(message.smartQuotes);
    throw new Error(message.invalidJson);
  }

  const monthOnly = monthOnlyDatePaths(parsed);
  if (monthOnly.length) {
    throw new Error(message.monthOnlyDates.replace("{paths}", monthOnly.slice(0, 5).join(", ")));
  }
  return parsed;
}

async function copyPrompt(textarea, button, message) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(textarea.value);
    } else {
      textarea.focus();
      textarea.select();
      if (!document.execCommand("copy")) throw new Error("copy failed");
    }
    button.textContent = message.copied;
  } catch (_error) {
    textarea.focus();
    textarea.select();
    window.alert(message.copyFailed);
  }
}

export async function openManualChatGPTResearch(
  body,
  wine,
  topics,
  locale,
  onImported,
  errorMessage,
) {
  const message = messages(locale);
  clear(body);
  body.appendChild(el("p", { class: "research-progress", text: message.preparing }));

  let prepared;
  try {
    prepared = await api.post(`/wines/${wine.id}/research/manual-chatgpt`, {
      topics,
      locale,
    });
  } catch (error) {
    clear(body);
    body.appendChild(
      el("p", {
        class: "form-error",
        text: errorMessage(error),
      }),
    );
    return;
  }

  clear(body);
  body.appendChild(el("p", { class: "research-warning", text: message.intro }));
  body.appendChild(el("label", { text: message.prompt }));

  const prompt = el("textarea", {
    class: "research-manual-prompt",
    rows: 18,
    readOnly: true,
  });
  prompt.value = prepared.prompt;
  body.appendChild(prompt);

  const copyButton = el("button", { type: "button", text: message.copy });
  copyButton.addEventListener("click", () => copyPrompt(prompt, copyButton, message));
  body.appendChild(el("div", { class: "research-actions" }, [copyButton]));

  body.appendChild(el("h4", { text: message.formatTitle }));
  body.appendChild(
    el(
      "ul",
      { class: "research-sources" },
      message.formatRules.map((rule) => el("li", { text: rule })),
    ),
  );


  body.appendChild(el("label", { text: message.response }));
  const response = el("textarea", {
    class: "research-manual-response",
    rows: 14,
    placeholder: message.responsePlaceholder,
  });
  body.appendChild(response);

  const errorNode = el("p", { class: "form-error", hidden: true });
  body.appendChild(errorNode);

  const importButton = el("button", {
    type: "button",
    class: "primary",
    text: message.import,
  });
  body.appendChild(el("div", { class: "research-actions" }, [importButton]));

  importButton.addEventListener("click", async () => {
    const raw = response.value.trim();
    if (!raw) {
      errorNode.hidden = false;
      errorNode.textContent = message.empty;
      return;
    }
    
    let parsed;
    try {
      parsed = parseManualChatGPTResponse(raw, locale);
    } catch (error) {
      errorNode.hidden = false;
      errorNode.textContent = error.message;
      return;
    }

errorNode.hidden = true;
    importButton.disabled = true;
    importButton.textContent = message.importing;
    try {
      const job = await api.post(`/wines/${wine.id}/research/manual-chatgpt/import`, {
        topics,
        locale,
        response: parsed,
      });
      await onImported(job);
    } catch (error) {
      errorNode.hidden = false;
      errorNode.textContent = errorMessage(error);
      importButton.disabled = false;
      importButton.textContent = message.import;
    }
  });
}
