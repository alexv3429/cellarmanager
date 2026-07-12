import * as api from "../api.js";
import * as db from "../db.js";
import { t } from "../i18n.js";
import { el } from "../dom.js";

export async function renderLogin(container) {
  const errorBox = el("p", { class: "form-error", hidden: true });
  const usernameInput = el("input", { type: "text", name: "username", required: true, autocomplete: "username" });
  const passwordInput = el("input", { type: "password", name: "password", required: true, autocomplete: "current-password" });

  const loginForm = el("form", { class: "auth-form" }, [
    el("h1", { text: t("login.title") }),
    el("label", {}, [el("span", { text: t("login.username") }), usernameInput]),
    el("label", {}, [el("span", { text: t("login.password") }), passwordInput]),
    errorBox,
    el("button", { type: "submit", class: "primary", text: t("login.submit") }),
  ]);

  loginForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    errorBox.hidden = true;
    try {
      const resp = await api.post("/auth/login", {
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      });
      await db.setMeta("token", resp.access_token);
      window.dispatchEvent(new CustomEvent("auth:login"));
    } catch (err) {
      errorBox.textContent = err.status === 401 ? t("login.error") : t("common.error_generic");
      errorBox.hidden = false;
    }
  });

  // A registration panel is always shown, but the backend only ever accepts
  // it while zero accounts exist (see docs/security.md) - so this can never
  // become an open public sign-up, it just bootstraps the very first user.
  const regUsername = el("input", { type: "text", name: "reg-username", minlength: 3, required: true });
  const regPassword = el("input", { type: "password", name: "reg-password", minlength: 8, required: true });
  const regError = el("p", { class: "form-error", hidden: true });
  const regForm = el("form", { class: "auth-form auth-form-secondary" }, [
    el("h2", { text: t("login.register_title") }),
    el("p", { class: "hint", text: t("login.register_hint") }),
    el("label", {}, [el("span", { text: t("login.username") }), regUsername]),
    el("label", {}, [el("span", { text: t("login.password") }), regPassword]),
    regError,
    el("button", { type: "submit", text: t("login.register_submit") }),
  ]);
  regForm.addEventListener("submit", async (e) => {
    e.preventDefault();
    regError.hidden = true;
    try {
      const resp = await api.post("/auth/register", { username: regUsername.value.trim(), password: regPassword.value });
      await db.setMeta("token", resp.access_token);
      window.dispatchEvent(new CustomEvent("auth:login"));
    } catch (err) {
      regError.textContent = err.status === 403 ? t("auth.registration_closed") : t("common.error_generic");
      regError.hidden = false;
    }
  });

  const wrapper = el("div", { class: "auth-page" }, [loginForm, regForm]);
  container.appendChild(wrapper);
  usernameInput.focus();
}
