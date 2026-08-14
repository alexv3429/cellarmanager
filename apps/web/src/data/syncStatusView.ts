export type SyncStatusState =
  | "connecting"
  | "error"
  | "initial"
  | "offline"
  | "queued-offline"
  | "refreshing"
  | "up-to-date"
  | "uploading"

export type SyncStatusTone = "error" | "info" | "success" | "warning"

export interface SyncStatusInput {
  connected: boolean
  connecting: boolean
  downloading: boolean
  error: string | null
  hasSynced: boolean
  isOnline: boolean
  pendingOperationCount: number
  uploading: boolean
}

export interface SyncStatusPresentation {
  detail: string
  label: string
  state: SyncStatusState
  tone: SyncStatusTone
}

function pendingLabel(count: number): string {
  return `${count} ${count === 1 ? "change" : "changes"}`
}

export function getSyncStatusPresentation(
  input: SyncStatusInput,
): SyncStatusPresentation {
  if (input.error) {
    return {
      detail: input.error,
      label: "Synchronization needs attention",
      state: "error",
      tone: "error",
    }
  }

  if (!input.isOnline) {
    if (input.pendingOperationCount > 0) {
      return {
        detail: `${pendingLabel(input.pendingOperationCount)} stored locally; synchronization resumes after reconnection`,
        label: "Changes queued offline",
        state: "queued-offline",
        tone: "warning",
      }
    }

    return {
      detail: input.hasSynced
        ? "Local cellar data is available on this device"
        : "Reconnect to finish the initial synchronization",
      label: "Offline",
      state: "offline",
      tone: "warning",
    }
  }

  if (input.connecting || !input.connected) {
    return {
      detail:
        input.pendingOperationCount > 0
          ? `${pendingLabel(input.pendingOperationCount)} waiting for the connection`
          : "Connecting to synchronized cellar data",
      label: "Connecting…",
      state: "connecting",
      tone: "info",
    }
  }

  if (input.uploading || input.pendingOperationCount > 0) {
    return {
      detail:
        input.pendingOperationCount > 0
          ? `${pendingLabel(input.pendingOperationCount)} waiting for server confirmation`
          : "Sending local changes to the server",
      label: "Uploading changes…",
      state: "uploading",
      tone: "info",
    }
  }

  if (input.downloading) {
    return {
      detail: "Refreshing this device with server changes",
      label: "Refreshing local data…",
      state: "refreshing",
      tone: "info",
    }
  }

  if (!input.hasSynced) {
    return {
      detail: "Waiting for the first complete local copy",
      label: "Initial synchronization pending",
      state: "initial",
      tone: "info",
    }
  }

  return {
    detail: "Local data is ready and no changes are queued",
    label: "Up to date",
    state: "up-to-date",
    tone: "success",
  }
}
