import { StrictMode } from "react"
import { createRoot } from "react-dom/client"
import { PowerSyncContext } from "@powersync/react"

import "./index.css"
import App from "./App"
import { powerSyncDatabase } from "./data/powersync/database"

const rootElement = document.getElementById("root")

if (!rootElement) {
  throw new Error("Root element not found")
}

createRoot(rootElement).render(
  <StrictMode>
    <PowerSyncContext.Provider value={powerSyncDatabase}>
      <App />
    </PowerSyncContext.Provider>
  </StrictMode>,
)
