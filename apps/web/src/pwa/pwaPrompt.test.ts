import { describe, expect, it } from "vitest"

import { getPwaPromptMode } from "./pwaPrompt"

describe("PWA prompt priority", () => {
  it("stays hidden when no lifecycle action is available", () => {
    expect(
      getPwaPromptMode({
        installAvailable: false,
        needRefresh: false,
        offlineReady: false,
      }),
    ).toBeNull()
  })

  it("offers installation when supported by the browser", () => {
    expect(
      getPwaPromptMode({
        installAvailable: true,
        needRefresh: false,
        offlineReady: false,
      }),
    ).toBe("install")
  })

  it("prioritizes cache readiness and application updates", () => {
    expect(
      getPwaPromptMode({
        installAvailable: true,
        needRefresh: false,
        offlineReady: true,
      }),
    ).toBe("offline-ready")

    expect(
      getPwaPromptMode({
        installAvailable: true,
        needRefresh: true,
        offlineReady: true,
      }),
    ).toBe("update")
  })
})
