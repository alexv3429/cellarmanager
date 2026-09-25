import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  DISPLAY_NAME_MAX_LENGTH, getAccountProfile, requestAccountPasswordReset,
  saveAccountDisplayName, saveAccountLanguagePreference, type AccountProfile,
} from "../auth/accountProfile"
import { useLanguage } from "../i18n/useLanguage"
import type { LanguagePreference } from "../i18n/language"
import { AccountBackLink } from "./AccountNavigation"
import { Notice } from "./Notice"
import "./AccountView.css"

export function AccountView({ userId, isOnline }: { userId: string; isOnline: boolean }) {
  const { preference: activeLanguagePreference, setSavedPreference, t } = useLanguage()
  const [account, setAccount] = useState<AccountProfile | null>(null)
  const [name, setName] = useState("")
  const [languagePreference, setLanguagePreference] = useState<LanguagePreference>(activeLanguagePreference)
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<"name" | "password" | "language" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [languageSaved, setLanguageSaved] = useState(false)
  const [emailSent, setEmailSent] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  const submitting = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)
  const tRef = useRef(t)
  tRef.current = t

  useEffect(() => {
    document.title = `${t("account.title")} · CellarManager`
  }, [t])

  useEffect(() => { heading.current?.focus() }, [])

  useEffect(() => {
    const current = ++generation.current
    submitting.current = false
    setBusy(null)
    setAccount(null)
    setName("")
    setLanguagePreference("system")
    setError(null)
    setSaved(false)
    setEmailSent(null)
    setLoading(isOnline)
    if (isOnline) {
      void getAccountProfile(userId, { isCurrent: () => generation.current === current })
        .then((value) => {
          if (generation.current !== current) return
          setAccount(value)
          setName(value.displayName)
          setLanguagePreference(value.languagePreference)
          setSavedPreference(value.languagePreference)
        })
        .catch(() => {
          if (generation.current === current) setError(tRef.current("account.loadError"))
        })
        .finally(() => { if (generation.current === current) setLoading(false) })
    }
    return () => { generation.current = current + 1 }
  }, [isOnline, userId, reload, setSavedPreference])

  async function submit(kind: "name" | "password" | "language") {
    if (!isOnline || !account || loading || submitting.current) return
    submitting.current = true
    const current = generation.current
    const isCurrent = () => generation.current === current
    setBusy(kind)
    setError(null)
    setSaved(false)
    setLanguageSaved(false)
    try {
      if (kind === "name") {
        const value = await saveAccountDisplayName(userId, name, { isCurrent })
        if (!isCurrent()) return
        setAccount(value)
        setName(value.displayName)
        setSaved(true)
      } else if (kind === "language") {
        const value = await saveAccountLanguagePreference(userId, languagePreference, { isCurrent })
        if (!isCurrent()) return
        setAccount(value)
        setLanguagePreference(value.languagePreference)
        setSavedPreference(value.languagePreference)
        setLanguageSaved(true)
      } else {
        const email = await requestAccountPasswordReset(userId, window.location.origin, { isCurrent })
        if (isCurrent()) setEmailSent(email)
      }
    } catch (caught) {
      if (isCurrent()) setError(caught instanceof Error ? caught.message : "The request could not be confirmed. Reload your account before retrying.")
    } finally {
      if (isCurrent()) { submitting.current = false; setBusy(null) }
    }
  }

  function saveName(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit("name")
  }

  function saveLanguage(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    void submit("language")
  }

  const disabled = !isOnline || !account || loading || busy !== null
  return <main className="app-shell account-page">
    <AccountBackLink />
    <header>
      <h1 ref={heading} tabIndex={-1}>{t("account.title")}</h1>
      <p>{t("account.intro")}</p>
    </header>
    {!isOnline ? <Notice role="status" tone="warning">{t("account.offline")}</Notice> : null}
    {loading ? <Notice role="status">{t("account.loading")}</Notice> : null}
    {error ? <Notice role="alert" tone="error">{error}
      <p><button type="button" disabled={!isOnline || busy !== null} onClick={() => setReload((value) => value + 1)}>{t("account.reload")}</button></p>
    </Notice> : null}
    {account ? <>
      <section className="account-page__card" aria-labelledby="profile-heading">
        <h2 id="profile-heading">{t("account.profile")}</h2>
        <label className="account-page__field">{t("account.email")}
          <input type="email" value={account.email} readOnly autoComplete="username" aria-describedby="account-email-help" />
        </label>
        <p id="account-email-help">{t("account.emailHelp")}</p>
        <form className="account-page__form" onSubmit={saveName}>
          <label className="account-page__field" htmlFor="account-name">{t("account.displayName")}</label>
          <input id="account-name" autoComplete="nickname" maxLength={DISPLAY_NAME_MAX_LENGTH}
            aria-describedby="account-name-help" disabled={disabled} value={name}
            onChange={(event) => { setName(event.target.value); setSaved(false) }} />
          <p id="account-name-help">{t("account.displayNameHelp")}</p>
          <button disabled={disabled || name.trim() === account.displayName} type="submit">{busy === "name" ? t("account.saving") : t("account.saveName")}</button>
          {saved ? <Notice role="status" tone="success">{t("account.nameSaved")}</Notice> : null}
        </form>
      </section>
      <section className="account-page__card" aria-labelledby="language-heading">
        <h2 id="language-heading">{t("account.language")}</h2>
        <p id="account-language-help">{t("account.languageHelp")}</p>
        <form className="account-page__form" onSubmit={saveLanguage}>
          <label className="account-page__field" htmlFor="account-language">{t("account.language")}</label>
          <select id="account-language" aria-describedby="account-language-help" disabled={disabled}
            value={languagePreference} onChange={(event) => { setLanguagePreference(event.target.value as LanguagePreference); setLanguageSaved(false) }}>
            <option value="system">{t("account.languageDevice")}</option>
            <option value="en">{t("account.languageEnglish")}</option>
            <option value="fr">{t("account.languageFrench")}</option>
          </select>
          <button disabled={disabled || languagePreference === account.languagePreference} type="submit">
            {busy === "language" ? t("account.saving") : t("account.languageSave")}
          </button>
          {languageSaved ? <Notice role="status" tone="success">{t("account.languageSaved")}</Notice> : null}
        </form>
      </section>
      <section className="account-page__card" aria-labelledby="password-heading">
        <h2 id="password-heading">{t("account.password")}</h2>
        <p>{t("account.passwordHelp")}</p>
        <button disabled={disabled || emailSent !== null} type="button" onClick={() => void submit("password")}>
          {busy === "password" ? t("account.passwordSending") : emailSent ? t("account.passwordRequested") : t("account.passwordSend")}
        </button>
        {emailSent ? <Notice role="status" tone="success">{t("account.passwordSent", { email: emailSent })}</Notice> : null}
        <p className="account-page__hint">{t("account.passwordHint")}</p>
      </section>
    </> : null}
  </main>
}
