import { useEffect, useState } from "react"
import { useRegisterSW } from "virtual:pwa-register/react"

import { getPwaPromptMode } from "./pwaPrompt"

interface InstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: "accepted" | "dismissed"
    platform: string
  }>
}

export function PwaUpdatePrompt() {
  const {
    offlineReady: [offlineReady, setOfflineReady],
    needRefresh: [needRefresh, setNeedRefresh],
    updateServiceWorker,
  } = useRegisterSW({
    onRegisterError(error) {
      console.error(
        "Unable to register the service worker",
        error,
      )
    },
  })
  const [installPrompt, setInstallPrompt] =
    useState<InstallPromptEvent | null>(null)

  useEffect(() => {
    function captureInstallPrompt(event: Event) {
      event.preventDefault()
      setInstallPrompt(event as InstallPromptEvent)
    }

    function clearInstallPrompt() {
      setInstallPrompt(null)
    }

    window.addEventListener(
      "beforeinstallprompt",
      captureInstallPrompt,
    )
    window.addEventListener(
      "appinstalled",
      clearInstallPrompt,
    )

    return () => {
      window.removeEventListener(
        "beforeinstallprompt",
        captureInstallPrompt,
      )
      window.removeEventListener(
        "appinstalled",
        clearInstallPrompt,
      )
    }
  }, [])

  const mode = getPwaPromptMode({
    installAvailable: installPrompt !== null,
    needRefresh,
    offlineReady,
  })

  if (!mode) {
    return null
  }

  function close() {
    setOfflineReady(false)
    setNeedRefresh(false)
    setInstallPrompt(null)
  }

  async function install() {
    if (!installPrompt) {
      return
    }

    try {
      await installPrompt.prompt()
      await installPrompt.userChoice
    } catch (error) {
      console.error("Unable to open the install prompt", error)
    } finally {
      setInstallPrompt(null)
    }
  }

  return (
    <aside
      aria-live="polite"
      className="pwa-notice"
      role="status"
    >
      <strong>
        {mode === "install"
          ? "Install CellarManager"
          : mode === "update"
            ? "Update available"
            : "Ready offline"}
      </strong>

      <p>
        {mode === "install"
          ? "Add the app to this device for quick access and reliable offline startup."
          : mode === "update"
            ? "Reload to use the latest CellarManager version."
            : "CellarManager can now open without a network connection."}
      </p>

      <div className="pwa-notice__actions">
        {mode === "update" ? (
          <button
            onClick={() => {
              void updateServiceWorker(true)
            }}
            type="button"
          >
            Update now
          </button>
        ) : null}

        {mode === "install" ? (
          <button onClick={() => void install()} type="button">
            Install app
          </button>
        ) : null}

        <button onClick={close} type="button">
          {mode === "install" ? "Not now" : "Dismiss"}
        </button>
      </div>
    </aside>
  )
}
