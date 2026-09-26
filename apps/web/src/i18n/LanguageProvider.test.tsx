// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import type { Session } from "@supabase/supabase-js"
import { LanguageProvider } from "./LanguageProvider"
import { useLanguage } from "./useLanguage"

function Probe() {
  const { language, preference, setSavedPreference, t } = useLanguage()
  return <>
    <div>{language}|{preference}|{t("account.link")}</div>
    <button aria-label="Set English" onClick={() => setSavedPreference("en")} type="button" />
  </>
}

let root: Root
let container: HTMLDivElement
let previousLanguages: PropertyDescriptor | undefined
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  previousLanguages = Object.getOwnPropertyDescriptor(window.navigator, "languages")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})
afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  if (previousLanguages) Object.defineProperty(window.navigator, "languages", previousLanguages)
  else Reflect.deleteProperty(window.navigator, "languages")
  vi.unstubAllGlobals()
})

async function render(sessionPreference: unknown, isOnline = true, userId: string | null = "self") {
  const session = sessionPreference === null ? null : {
    user: { id: userId, user_metadata: { preferred_language: sessionPreference } },
  } as unknown as Session
  await act(async () => root.render(<LanguageProvider userId={userId} session={session} isOnline={isOnline}><Probe /></LanguageProvider>))
}

describe("language provider", () => {
  it("detects French from the device by default and sets the document language", async () => {
    Object.defineProperty(window.navigator, "languages", { configurable: true, value: ["fr-FR", "en-US"] })
    await render(null, true, null)
    expect(container.textContent).toBe("fr|system|Compte")
    expect(document.documentElement.lang).toBe("fr")
  })

  it("falls back to English for unsupported device locales", async () => {
    Object.defineProperty(window.navigator, "languages", { configurable: true, value: ["de-DE"] })
    await render(null, true, null)
    expect(container.textContent).toBe("en|system|Account")
    expect(document.documentElement.lang).toBe("en")
  })

  it("uses the authenticated per-user preference instead of the current device locale", async () => {
    Object.defineProperty(window.navigator, "languages", { configurable: true, value: ["en-US"] })
    await render("fr")
    expect(container.textContent).toBe("fr|fr|Compte")
    expect(window.localStorage.getItem("cellarmanager.languagePreference.self")).toBe("fr")
  })

  it("updates the document language when the account preference changes", async () => {
    Object.defineProperty(window.navigator, "languages", { configurable: true, value: ["fr-FR"] })
    await render(null)
    expect(document.documentElement.lang).toBe("fr")
    await act(async () => container.querySelector("button")?.click())
    expect(container.textContent).toContain("en|en|Account")
    expect(document.documentElement.lang).toBe("en")
  })

  it("restores only this account's saved language preference while offline", async () => {
    window.localStorage.setItem("cellarmanager.languagePreference.self", "fr")
    await render(null, false)
    expect(container.textContent).toBe("fr|fr|Compte")
  })
})
