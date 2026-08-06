import { useRegisterSW } from "virtual:pwa-register/react"

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

  if (!offlineReady && !needRefresh) {
    return null
  }

  function close() {
    setOfflineReady(false)
    setNeedRefresh(false)
  }

  return (
    <aside
      aria-live="polite"
      className="pwa-notice"
      role="status"
    >
      <p>
        {offlineReady
          ? "CellarManager is ready to open offline."
          : "A new CellarManager version is available."}
      </p>

      <div className="pwa-notice__actions">
        {needRefresh ? (
          <button
            onClick={() => {
              void updateServiceWorker(true)
            }}
            type="button"
          >
            Update now
          </button>
        ) : null}

        <button onClick={close} type="button">
          Dismiss
        </button>
      </div>
    </aside>
  )
}
