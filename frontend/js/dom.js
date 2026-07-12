/**
 * Small helpers shared by every page module. `el()` builds elements without
 * ever passing user-supplied text through innerHTML, so producer names,
 * notes, etc. can never be interpreted as markup.
 */
export function el(tag, attrs = {}, children = []) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on") && typeof value === "function") node.addEventListener(key.slice(2), value);
    else if (value !== undefined && value !== null && value !== false) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of [].concat(children)) {
    if (child === null || child === undefined) continue;
    node.appendChild(typeof child === "string" ? document.createTextNode(child) : child);
  }
  return node;
}

export function clear(node) {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function field(labelText, inputEl) {
  return el("label", { class: "field" }, [el("span", { class: "field-label", text: labelText }), inputEl]);
}

export function selectEl(options, { value, name } = {}) {
  const select = el("select", { name });
  for (const opt of options) {
    const optionEl = el("option", { value: opt.value, text: opt.label });
    if (opt.value === value) optionEl.selected = true;
    select.appendChild(optionEl);
  }
  return select;
}

export function showToast(message, { isError = false } = {}) {
  const toast = el("div", { class: `toast ${isError ? "toast-error" : ""}`, text: message });
  document.body.appendChild(toast);
  requestAnimationFrame(() => toast.classList.add("visible"));
  setTimeout(() => {
    toast.classList.remove("visible");
    setTimeout(() => toast.remove(), 300);
  }, 3500);
}

export function formatDate(isoString) {
  if (!isoString) return "";
  try {
    return new Date(isoString).toLocaleDateString();
  } catch {
    return isoString;
  }
}
