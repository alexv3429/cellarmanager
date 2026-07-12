import * as api from "../api.js";
import * as db from "../db.js";
import { t, getLocale } from "../i18n.js";
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
  loginForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    errorBox.hidden = true;
    try {
      const response = await api.post("/auth/login", {
        username: usernameInput.value.trim(),
        password: passwordInput.value,
      });
      await db.setMeta("token", response.access_token);
      window.dispatchEvent(new CustomEvent("auth:login"));
    } catch (error) {
      errorBox.textContent = error.status === 401 ? t("login.error") : (error.detail?.message || t("common.error_generic"));
      errorBox.hidden = false;
    }
  });

  const regUsername = el("input", { type: "text", name: "reg-username", minlength: 3, required: true, autocomplete: "username" });
  const regPassword = el("input", { type: "password", name: "reg-password", minlength: 8, required: true, autocomplete: "new-password" });
  const setupToken = el("input", { type: "password", name: "setup-token", autocomplete: "one-time-code" });
  const regError = el("p", { class: "form-error", hidden: true });
  const regForm = el("form", { class: "auth-form auth-form-secondary" }, [
    el("h2", { text: t("login.register_title") }),
    el("p", { class: "hint", text: t("login.register_hint") }),
    el("label", {}, [el("span", { text: t("login.username") }), regUsername]),
    el("label", {}, [el("span", { text: t("login.password") }), regPassword]),
    el("label", {}, [
      el("span", { text: t("login.setup_token") }),
      setupToken,
      el("small", { class: "hint", text: t("login.setup_token_hint") }),
    ]),
    regError,
    el("button", { type: "submit", text: t("login.register_submit") }),
  ]);
  regForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    regError.hidden = true;
    try {
      const response = await api.post("/auth/register", {
        username: regUsername.value.trim(),
        password: regPassword.value,
        locale: getLocale(),
        setup_token: setupToken.value || null,
      });
      await db.setMeta("token", response.access_token);
      window.dispatchEvent(new CustomEvent("auth:login"));
    } catch (error) {
      if (error.status === 403 && error.detail === "auth.registration_closed") {
        regError.textContent = t("auth.registration_closed");
      } else if (error.status === 403 && error.detail === "auth.invalid_setup_token") {
        regError.textContent = t("auth.invalid_setup_token");
      } else {
        regError.textContent = error.detail?.message || t("common.error_generic");
      }
      regError.hidden = false;
    }
  });

  container.appendChild(el("div", { class: "auth-page" }, [loginForm, regForm]));
  usernameInput.focus();
}
