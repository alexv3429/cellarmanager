export type PwaPromptMode =
  | "install"
  | "offline-ready"
  | "update"

interface PwaPromptState {
  installAvailable: boolean
  needRefresh: boolean
  offlineReady: boolean
}

export function getPwaPromptMode({
  installAvailable,
  needRefresh,
  offlineReady,
}: PwaPromptState): PwaPromptMode | null {
  if (needRefresh) {
    return "update"
  }

  if (offlineReady) {
    return "offline-ready"
  }

  return installAvailable ? "install" : null
}
