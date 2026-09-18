import { useEffect, useRef, useState, type FormEvent } from "react"
import {
  DISPLAY_NAME_MAX_LENGTH, getAccountProfile, requestAccountPasswordReset,
  saveAccountDisplayName, type AccountProfile,
} from "../auth/accountProfile"
import { AccountBackLink } from "./AccountNavigation"
import { Notice } from "./Notice"
import "./AccountView.css"

export function AccountView({ userId, isOnline }: { userId: string; isOnline: boolean }) {
  const [account, setAccount] = useState<AccountProfile | null>(null)
  const [name, setName] = useState("")
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState<"name" | "password" | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [saved, setSaved] = useState(false)
  const [emailSent, setEmailSent] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const generation = useRef(0)
  const submitting = useRef(false)
  const heading = useRef<HTMLHeadingElement>(null)

  useEffect(() => {
    document.title = "Account & profile · CellarManager"
    heading.current?.focus()
  }, [])

  useEffect(() => {
    const current = ++generation.current
    submitting.current = false
    setBusy(null)
    setAccount(null)
    setName("")
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
        })
        .catch(() => {
          if (generation.current === current) setError("Unable to load your account. Check your connection or sign in again.")
        })
        .finally(() => { if (generation.current === current) setLoading(false) })
    }
    return () => { generation.current = current + 1 }
  }, [isOnline, userId, reload])

  async function submit(kind: "name" | "password") {
    if (!isOnline || !account || loading || submitting.current) return
    submitting.current = true
    const current = generation.current
    const isCurrent = () => generation.current === current
    setBusy(kind)
    setError(null)
    setSaved(false)
    try {
      if (kind === "name") {
        const value = await saveAccountDisplayName(userId, name, { isCurrent })
        if (!isCurrent()) return
        setAccount(value)
        setName(value.displayName)
        setSaved(true)
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

  const disabled = !isOnline || !account || loading || busy !== null
  return <main className="app-shell account-page">
    <AccountBackLink />
    <header>
      <h1 ref={heading} tabIndex={-1}>Account &amp; profile</h1>
      <p>Your personal account, across all your households. Owners and Members manage only their own profile and password.</p>
    </header>
    {!isOnline ? <Notice role="status" tone="warning">Reconnect to view or change your account. Account changes are not queued offline.</Notice> : null}
    {loading ? <Notice role="status">Loading your account…</Notice> : null}
    {error ? <Notice role="alert" tone="error">{error}
      <p><button type="button" disabled={!isOnline || busy !== null} onClick={() => setReload((value) => value + 1)}>Reload account</button></p>
    </Notice> : null}
    {account ? <>
      <section className="account-page__card" aria-labelledby="profile-heading">
        <h2 id="profile-heading">Your profile</h2>
        <label className="account-page__field">Sign-in email
          <input type="email" value={account.email} readOnly autoComplete="username" aria-describedby="account-email-help" />
        </label>
        <p id="account-email-help">Your email stays unchanged. It is used for sign-in, invitations and password recovery.</p>
        <form className="account-page__form" onSubmit={saveName}>
          <label className="account-page__field" htmlFor="account-name">Display name</label>
          <input id="account-name" autoComplete="nickname" maxLength={DISPLAY_NAME_MAX_LENGTH}
            aria-describedby="account-name-help" disabled={disabled} value={name}
            onChange={(event) => { setName(event.target.value); setSaved(false) }} />
          <p id="account-name-help">Shown to collaborators in every household you belong to. Leave blank to use your email. This does not change ownership or permissions.</p>
          <button disabled={disabled || name.trim() === account.displayName} type="submit">{busy === "name" ? "Saving…" : "Save display name"}</button>
          {saved ? <Notice role="status" tone="success">Display name saved. Reopen Members to see the updated name.</Notice> : null}
        </form>
      </section>
      <section className="account-page__card" aria-labelledby="password-heading">
        <h2 id="password-heading">Change password</h2>
        <p>We will email you a secure link to choose a new password. Open it to verify that you control this account. Your current password stays unchanged until you finish.</p>
        <button disabled={disabled || emailSent !== null} type="button" onClick={() => void submit("password")}>{busy === "password" ? "Sending…" : emailSent ? "Email requested" : "Send password reset email"}</button>
        {emailSent ? <Notice role="status" tone="success">Password reset email requested for {emailSent}. Check your inbox and Spam folder. Open the newest link, set and confirm your new password, then continue to your cellar.</Notice> : null}
        <p className="account-page__hint">No email? Check Spam and wait a minute before reloading this page to retry. Your bottles, memberships and personal wine preferences are not changed.</p>
      </section>
    </> : null}
  </main>
}
