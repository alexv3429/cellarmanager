// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { getFallbackSubject, narrowFallbackToAppellation } from "../data/drinkingWindowFallbackCorrections"
import { FallbackSubjectCorrectionEditor } from "./FallbackSubjectCorrectionEditor"

vi.mock("../data/drinkingWindowFallbackCorrections", () => ({
  getFallbackSubject: vi.fn(), correctFallbackSubject: vi.fn(),
  narrowFallbackToAppellation: vi.fn(), memberTargetId: vi.fn(),
}))
vi.mock("../i18n/useLanguage", () => ({ useLanguage: () => ({ t: (key: string) => key }) }))
vi.mock("./CurationTargetPicker", () => ({ CurationTargetPicker: (props: {
  onChange: (value: { id: string; label: string; detail: string }) => void
}) => <button type="button" onClick={() => props.onChange({ id: "app", label: "Appellation", detail: "region" })}>
  Choose test appellation</button> }))

let root: Root
let container: HTMLDivElement
beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getFallbackSubject).mockResolvedValue({ kind: "group", hash: "current-hash",
    data: { scope: "region", group_key: "Test group", definition: "A sufficiently detailed test definition." } })
  vi.mocked(narrowFallbackToAppellation).mockResolvedValue()
  container = document.createElement("div"); document.body.append(container); root = createRoot(container)
})
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.clearAllMocks(); vi.unstubAllGlobals() })

describe("correcting the scope of a shared group", () => {
  it("requires an appellation, explanation and explicit confirmation", async () => {
    const changed = vi.fn().mockResolvedValue(undefined)
    await act(async () => root.render(<FallbackSubjectCorrectionEditor versionId="draft" kind="group"
      subjectId="group" isOnline onChanged={changed} />))
    const button = [...container.querySelectorAll("button")].find((item) => item.textContent === "Correct the appellation scope")!
    expect(button.disabled).toBe(true)
    await act(async () => [...container.querySelectorAll("button")].find((item) => item.textContent === "Choose test appellation")?.click())
    const reason = [...container.querySelectorAll("textarea")].find((item) => item.minLength === 30)!
    await act(async () => {
      Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")?.set?.call(reason,
        "The entire group is explicitly inside this appellation.")
      reason.dispatchEvent(new Event("input", { bubbles: true }))
    })
    expect(button.disabled).toBe(true)
    await act(async () => (container.querySelector('input[type="checkbox"]') as HTMLInputElement).click())
    expect(button.disabled).toBe(false)
    await act(async () => button.click())
    expect(narrowFallbackToAppellation).toHaveBeenCalledWith({ versionId: "draft", groupId: "group",
      appellationId: "app", expectedHash: "current-hash",
      reason: "The entire group is explicitly inside this appellation." })
    expect(changed).toHaveBeenCalledOnce()
  })
  it("does not offer this action for an appellation group", async () => {
    vi.mocked(getFallbackSubject).mockResolvedValue({ kind: "group", hash: "hash",
      data: { scope: "appellation", group_key: "Group", definition: "A sufficiently long test definition." } })
    await act(async () => root.render(<FallbackSubjectCorrectionEditor versionId="draft" kind="group"
      subjectId="group" isOnline onChanged={vi.fn()} />))
    expect(container.textContent).not.toContain("This group applies to one appellation")
  })
})
