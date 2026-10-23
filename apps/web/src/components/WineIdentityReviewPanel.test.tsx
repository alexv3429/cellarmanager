// @vitest-environment jsdom
import { act } from "react"
import { createRoot, type Root } from "react-dom/client"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"

import {
  getHouseholdWineIdentityStatus,
  manageHouseholdWineIdentity,
  requestSharedWineIdentity,
  searchHouseholdWineIdentities,
} from "../data/householdWineIdentities"
import { WineIdentityReviewPanel } from "./WineIdentityReviewPanel"

vi.mock("../data/householdWineIdentities", () => ({
  getHouseholdWineIdentityStatus: vi.fn(),
  manageHouseholdWineIdentity: vi.fn(),
  requestSharedWineIdentity: vi.fn(),
  searchHouseholdWineIdentities: vi.fn(),
}))

const wine = {
  id: "wine", household_id: "household", producer: "Barraud", cuvee: "Sur La Roche",
  vintage: 2023, color: "white", appellation: "Pouilly-Fuissé", area: "Bourgogne",
  format_ml: 750, wine_reference_id: null,
}
const identity = {
  referenceId: "release", referenceType: "release" as const,
  producerName: "Daniel Barraud", productName: "Pouilly-Fuissé Premier Cru Sur La Roche",
  vintageYear: 2023, releaseDesignator: null,
}
let root: Root
let container: HTMLDivElement

beforeEach(() => {
  vi.stubGlobal("IS_REACT_ACT_ENVIRONMENT", true)
  vi.mocked(getHouseholdWineIdentityStatus).mockReset().mockResolvedValue({
    wineId: wine.id, sourceFingerprint: "fingerprint", matchedReference: null, requestStatus: null,
  })
  vi.mocked(searchHouseholdWineIdentities).mockReset().mockResolvedValue([identity])
  vi.mocked(manageHouseholdWineIdentity).mockReset().mockResolvedValue("release")
  vi.mocked(requestSharedWineIdentity).mockReset().mockResolvedValue("request")
  container = document.createElement("div")
  document.body.append(container)
  root = createRoot(container)
})

afterEach(async () => {
  await act(async () => root.unmount())
  container.remove()
  vi.unstubAllGlobals()
})

async function click(label: string) {
  const button = [...container.querySelectorAll("button")].find((item) => item.textContent?.includes(label))
  expect(button, `Missing button ${label}`).toBeTruthy()
  await act(async () => button?.click())
}

async function openAndSelect() {
  await act(async () => root.render(<WineIdentityReviewPanel isOnline wines={[wine]} />))
  const details = container.querySelector("details")
  await act(async () => {
    if (details) details.open = true
    details?.dispatchEvent(new Event("toggle"))
  })
  await click("Barraud · Sur La Roche · 2023")
  expect(getHouseholdWineIdentityStatus).toHaveBeenCalledWith("wine")
}

async function enterQuery(value: string) {
  const input = container.querySelector<HTMLInputElement>('.wine-identity-review__editor input[type="search"]')
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, value)
    input?.dispatchEvent(new Event("input", { bubbles: true }))
  })
}

describe("household wine identity panel", () => {
  it("reviews one wine directly from its card and reports a private link change", async () => {
    const onChanged = vi.fn()
    await act(async () => root.render(<WineIdentityReviewPanel
      compact initialWineId="wine" isOnline onChanged={onChanged} wines={[wine]} />))
    const details = container.querySelector("details")
    await act(async () => {
      if (details) details.open = true
      details?.dispatchEvent(new Event("toggle"))
    })
    expect(container.textContent).toContain("Review this wine’s shared identity")
    expect(container.querySelector(".wine-identity-review__wines")).toBeNull()
    expect(getHouseholdWineIdentityStatus).toHaveBeenCalledWith("wine")
    await enterQuery("Barraud")
    await click("Search shared wines")
    await click("Daniel Barraud · Pouilly-Fuissé Premier Cru Sur La Roche")
    await click("Confirm this shared wine")
    expect(onChanged).toHaveBeenCalledTimes(1)
  })

  it("requires a selected shared release before confirming a household link", async () => {
    await openAndSelect()
    expect(manageHouseholdWineIdentity).not.toHaveBeenCalled()
    await enterQuery("Barraud")
    await click("Search shared wines")
    expect(searchHouseholdWineIdentities).toHaveBeenCalledWith("wine", "Barraud")
    await click("Daniel Barraud · Pouilly-Fuissé Premier Cru Sur La Roche")
    vi.mocked(getHouseholdWineIdentityStatus).mockResolvedValue({
      wineId: wine.id, sourceFingerprint: "fingerprint",
      matchedReference: { referenceId: "release", producerName: identity.producerName, productName: identity.productName },
      requestStatus: null,
    })
    await click("Confirm this shared wine")
    expect(manageHouseholdWineIdentity).toHaveBeenCalledWith(
      "wine", "link", identity, "fingerprint", null,
    )
    expect(container.textContent).toContain("Your wine description was not changed")
  })

  it("queues a missing identity without creating a shared wine", async () => {
    vi.mocked(searchHouseholdWineIdentities).mockResolvedValue([])
    await openAndSelect()
    await enterQuery("Unknown")
    await click("Search shared wines")
    await click("Request a shared wine entry")
    expect(requestSharedWineIdentity).toHaveBeenCalledWith("wine", "fingerprint")
    expect(manageHouseholdWineIdentity).not.toHaveBeenCalled()
  })
})
