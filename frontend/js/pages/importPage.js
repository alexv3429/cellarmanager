import * as api from "../api.js";
import { t } from "../i18n.js";
import { el, clear, selectEl } from "../dom.js";

export async function renderImport(container) {
  container.appendChild(el("h1", { text: t("import.title") }));
  container.appendChild(el("p", { class: "hint", text: t("import.help") }));

  const cellars = await api.get("/cellars").catch(() => []);
  const cellarSelect = selectEl([{ value: "", label: t("common.none") }, ...cellars.map((c) => ({ value: c.id, label: c.name }))]);
  const fileInput = el("input", { type: "file", accept: ".csv,text/csv", required: true });
  const submitBtn = el("button", { type: "submit", class: "primary", text: t("import.upload") });
  const errorBox = el("p", { class: "form-error", hidden: true });
  const reportBox = el("div", { class: "import-report" });

  const form = el("form", { class: "entity-form" }, [
    el("label", {}, [el("span", { text: t("import.choose_file") }), fileInput]),
    el("label", {}, [el("span", { text: t("import.default_cellar") }), cellarSelect]),
    errorBox,
    submitBtn,
  ]);

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    clear(reportBox);
    if (!fileInput.files.length) return;
    const formData = new FormData();
    formData.append("file", fileInput.files[0]);
    const qs = cellarSelect.value ? `?default_cellar_id=${encodeURIComponent(cellarSelect.value)}` : "";
    try {
      const report = await api.postForm(`/import${qs}`, formData);
      reportBox.appendChild(el("h2", { text: t("import.report_title") }));
      reportBox.appendChild(el("p", { text: t("import.imported", { count: report.imported }) }));
      reportBox.appendChild(el("p", { text: t("import.merged", { count: report.merged_into_existing_wine }) }));
      reportBox.appendChild(el("p", { text: t("import.skipped", { count: report.skipped }) }));
      if (report.warnings.length) {
        reportBox.appendChild(el("h3", { text: t("import.warnings") }));
        reportBox.appendChild(
          el(
            "ul",
            {},
            report.warnings.map((w) => el("li", { text: `Row ${w.row}: ${w.message}` }))
          )
        );
      } else {
        reportBox.appendChild(el("p", { class: "success-note", text: t("import.no_warnings") }));
      }
    } catch (err) {
      errorBox.textContent = err.detail || t("common.error_generic");
      errorBox.hidden = false;
    }
  });

  container.append(form, reportBox);
}
