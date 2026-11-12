// @vitest-environment jsdom
import { act } from "react"
import { createRoot } from "react-dom/client"
import { expect, it, vi } from "vitest"

import { CurationPlaceCreation } from "./CurationPlaceCreation"

it("does not make an enclosing fallback form invalid when the place editor is unused", async () => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  const container = document.createElement("div")
  document.body.append(container)
  const root = createRoot(container)
  await act(async () => root.render(<form><input required defaultValue="ready" />
    <CurationPlaceCreation isOnline /></form>))
  const form = container.querySelector("form")!
  expect(form.checkValidity()).toBe(true)
  for (const control of container.querySelectorAll(".drinking-window-place-creation input, .drinking-window-place-creation textarea")) {
    expect(control.hasAttribute("required")).toBe(false)
    expect(control.hasAttribute("minlength")).toBe(false)
  }
  expect(container.querySelector<HTMLButtonElement>(".drinking-window-place-creation button")?.disabled).toBe(true)
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})
