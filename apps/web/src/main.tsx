import { PowerSyncContext } from "@powersync/react"
import { StrictMode } from "react"
import { createRoot } from "react-dom/client"

import "./index.css"
import App from "./App"
import { powerSyncDatabase } from "./data/powersync/database"
import { PwaUpdatePrompt } from "./pwa/PwaUpdatePrompt"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element not found")
}

createRoot(rootElement).render(
  <StrictMode>
    <PowerSyncContext.Provider value={powerSyncDatabase}>
      <App />
      <PwaUpdatePrompt />
    </PowerSyncContext.Provider>
  </StrictMode>,
)
