import { el } from "../dom.js";

const COPY = {
  en: {
    edit: "Edit",
    title: "Edit proposed value",
    guidance: "Correct the value before accepting it. Confidence and evidence sources cannot be edited here.",
    save: "Save correction",
    cancel: "Cancel",
    invalid: "Enter a valid JSON object or array.",
    saving: "Saving…",
  },
  fr: {
    edit: "Modifier",
    title: "Modifier la valeur proposée",
    guidance: "Corrigez la valeur avant de l’accepter. La confiance et les sources ne sont pas modifiables ici.",
    save: "Enregistrer la correction",
    cancel: "Annuler",
    invalid: "Saisissez un objet ou un tableau JSON valide.",
    saving: "Enregistrement…",
  },
};

function messages(locale) {
  return COPY[(locale || "en").toLowerCase().split("-")[0]] || COPY.en;
}

export function parseCandidateEditJson(raw, locale = "en") {
  const message = messages(locale);
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch (_error) {
    throw new Error(message.invalid);
  }
  if (parsed === null || typeof parsed !== "object") {
    throw new Error(message.invalid);
  }
  return parsed;
}

export function createCandidateEditor(candidate, onSave, locale = "en") {
  const message = messages(locale);
  const panel = el("div", { class: "candidate-editor" });
  panel.hidden = true;

  const textarea = el("textarea", {
    class: "candidate-editor-json",
    rows: "14",
    spellcheck: "false",
    "aria-label": message.title,
  });
  textarea.value = JSON.stringify(candidate.value, null, 2);

  const errorNode = el("p", { class: "form-error" });
  errorNode.hidden = true;

  const editButton = el("button", {
    type: "button",
    class: "small",
    text: message.edit,
  });
  const saveButton = el("button", {
    type: "button",
    class: "small primary",
    text: message.save,
  });
  const cancelButton = el("button", {
    type: "button",
    class: "small",
    text: message.cancel,
  });

  panel.appendChild(el("h5", { text: message.title }));
  panel.appendChild(el("p", { class: "hint", text: message.guidance }));
  panel.appendChild(textarea);
  panel.appendChild(errorNode);
  panel.appendChild(
    el("div", { class: "research-actions" }, [saveButton, cancelButton]),
  );

  editButton.addEventListener("click", () => {
    textarea.value = JSON.stringify(candidate.value, null, 2);
    errorNode.hidden = true;
    panel.hidden = false;
    textarea.focus();
  });

  cancelButton.addEventListener("click", () => {
    panel.hidden = true;
    errorNode.hidden = true;
  });

  saveButton.addEventListener("click", async () => {
    let value;
    try {
      value = parseCandidateEditJson(textarea.value, locale);
    } catch (error) {
      errorNode.textContent = error.message;
      errorNode.hidden = false;
      return;
    }

    saveButton.disabled = true;
    saveButton.textContent = message.saving;
    errorNode.hidden = true;
    try {
      await onSave(candidate, value);
      panel.hidden = true;
    } catch (error) {
      errorNode.textContent = error.message || message.invalid;
      errorNode.hidden = false;
    } finally {
      saveButton.disabled = false;
      saveButton.textContent = message.save;
    }
  });

  return { button: editButton, panel };
}
