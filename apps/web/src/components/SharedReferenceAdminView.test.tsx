// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { describe, expect, it, vi } from "vitest"
import { SharedReferenceAdminView } from "./SharedReferenceAdminView"

vi.mock("./DrinkingWindowReviewWorkspace", () => ({
  DrinkingWindowReviewWorkspace: () => <div data-testid="curator-workspace">Curator tools</div>,
}))

describe("shared database administration", () => {
  it("does not mount curator tools without a verified grant", async () => {
    vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
    const container = document.createElement("div")
    const root = createRoot(container)
    const props = { householdId: "home", isOnline: true, onBackToCatalog: vi.fn() }
    await act(async () => root.render(<SharedReferenceAdminView {...props} accessChecked={false} canCurate={false} />))
    expect(container.querySelector('[data-testid="curator-workspace"]')).toBeNull()
    await act(async () => root.render(<SharedReferenceAdminView {...props} accessChecked canCurate={false} />))
    expect(container.textContent).toContain("authorized")
    expect(container.querySelector('[data-testid="curator-workspace"]')).toBeNull()
    await act(async () => root.render(<SharedReferenceAdminView {...props} accessChecked canCurate />))
    expect(container.querySelector('[data-testid="curator-workspace"]')).not.toBeNull()
    await act(async () => root.unmount())
    vi.unstubAllGlobals()
  })
})
