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
  },
};

function messages(locale) {
  return COPY[(locale || "en").toLowerCase().split("-")[0]] || COPY.en;
}

export function manualChatGPTButtonLabel(locale) {
  return messages(locale).button;
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
    errorNode.hidden = true;
    importButton.disabled = true;
    importButton.textContent = message.importing;
    try {
      const job = await api.post(`/wines/${wine.id}/research/manual-chatgpt/import`, {
        topics,
        locale,
        response: raw,
        auto_apply: false,
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
