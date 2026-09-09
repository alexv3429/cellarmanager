import { renderToStaticMarkup } from "react-dom/server"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { MemberCellarView, type MemberCellarRow } from "./MemberCellarView"
import { WineDetailView } from "./WineDetailView"

const { query, queueAdd, queueMove, queueRemove, rpc } = vi.hoisted(() => ({
  query: vi.fn<(sql: string) => { data: unknown[]; isLoading: boolean; error: null }>(),
  queueAdd: vi.fn(), queueMove: vi.fn(), queueRemove: vi.fn(), rpc: vi.fn(),
}))
vi.mock("@powersync/react", () => ({ useQuery: query }))
vi.mock("../data/supabase", () => ({ supabase: { rpc } }))
vi.mock("../data/powersync/inventoryOperations", () => ({ queueAdd, queueMove, queueRemove }))

const wine = {
  id: "wine-1", household_id: "household", producer: "Alvina Pernot", cuvee: "Clos de la Garenne",
  vintage: 2022, color: "white", appellation: "Puligny-Montrachet 1C", area: "Bourgogne", format_ml: 750,
  country: "France", classification: "Premier Cru", vineyard: null, grape_composition: [],
  sweetness_category: null, alcohol_percent: null, certifications: [], wine_reference_id: null,
  wine_reference_type: null, merged_into_wine_id: null,
}
const cellarRows: MemberCellarRow[] = [
  { ...wine, quantity: 3, cellar_id: "aging", cellar_name: "Aging cellar", location_code: "2B" },
  { ...wine, quantity: 1, cellar_id: "service", cellar_name: "Service cellar", location_code: "A1" },
  { ...wine, id: "wine-empty", producer: "Empty producer", quantity: 0, cellar_id: null, cellar_name: null, location_code: null },
]
beforeEach(() => vi.clearAllMocks())

describe("Member cellar access", () => {
  it.each([true, false])("combines positions into one read-only wine card (online: %s)", (isOnline) => {
    query.mockReturnValue({ data: cellarRows, isLoading: false, error: null })
    const html = renderToStaticMarkup(<MemberCellarView householdId="household" isOnline={isOnline} onOpenWine={vi.fn()} />)
    expect(html).toContain("1 wine · 4 bottles")
    expect(html.match(/<h2>/g)).toHaveLength(1)
    expect(html).toContain("Aging cellar / 2B · 3 bottles")
    expect(html).toContain("Service cellar / A1 · 1 bottle")
    expect(html).toContain("Include wines with no bottles")
    expect(html).not.toContain("Empty producer")
    expect(html).toContain("View wine")
    expect(html).not.toContain("Edit wine")
    expect(html).not.toContain("<form")
    expect(html).not.toContain("Add bottles")
    expect(queueAdd).not.toHaveBeenCalled()
    expect(rpc).not.toHaveBeenCalled()
  })

  it.each([false, true])("wine deep links respect shared editing permission %s", (canManageCellar) => {
    query.mockImplementation((sql) => ({ data: sql.includes("from wines\n") ? [wine]
      : sql.includes("from holdings h") ? [{ ...wine, id: "holding", wine_id: wine.id, location_id: "location", location_code: "A1", quantity: 3, revision: 1 }]
      : sql.includes("from locations l") ? [{ id: "location", household_id: "household", cellar_id: "cellar", cellar_name: "Main cellar", code: "A1" }]
      : [], isLoading: false, error: null }))
    const html = renderToStaticMarkup(<WineDetailView canManageCellar={canManageCellar}
      deviceRegistration={{ deviceIdByHousehold: { household: "device" }, error: null, isLoading: false,
        isReady: true, isRegistering: false, retryRegistration: vi.fn() }}
      householdId="household" isOnline onBack={vi.fn()} onOpenMergedWine={vi.fn()}
      returnView="cellar" userId="member" wineId={wine.id} />)
    expect(html).toContain("Clos de la Garenne")
    expect(html).toContain("Main cellar / A1")
    expect(html).toContain("Back to cellar")
    for (const action of ["Edit wine", "Edit facts", "Add bottles", "Add more", "Consume/remove", "Reference library match"]) {
      expect(html.includes(action), action).toBe(canManageCellar)
    }
    if (!canManageCellar) {
      expect(html).not.toContain("<form")
      expect(html).toContain("Only an Owner can add, move, or remove bottles")
    }
    expect(queueAdd).not.toHaveBeenCalled()
    expect(queueMove).not.toHaveBeenCalled()
    expect(queueRemove).not.toHaveBeenCalled()
  })
})
