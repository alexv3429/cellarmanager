import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import appellationTemplate from "../../../../docs/examples/appellation-profile-template.json"
import producerTemplate from "../../../../docs/examples/producer-research-template.json"
import regionTemplate from "../../../../docs/examples/region-profile-template.json"
import {
  createProfileIdentityBatch,
  getReviewedProfileMappings,
  importFullProfileExchange,
  previewFullProfileExchange,
  previewProfileIdentityBatch,
  previewProfileStaging,
  suggestProfileIdentities,
  suggestProfilePlaces,
  searchProfileLwin,
  reuseProfileLwin,
  stageProfileExchange,
  stageSelectedProfileWindows,
  type FullProfileImport,
} from "./drinkingWindowProfileExchange"

const imported: FullProfileImport = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  documentSha256: "a".repeat(64), kind: "producer", name: "Example",
  schemaVersion: "1.1.0", datasetVersion: "1.0.0", releaseCount: 1,
  submittedAt: "2026-10-30T00:00:00Z",
}

describe("complete profile exchange", () => {
  it("searches and reuses an LWIN product without approving dates or linking a cellar", async () => {
    const rpc = async (name: string, parameters: Record<string, unknown>) => {
      if (name === "search_drinking_window_profile_lwin") {
        expect(parameters.p_query).toBe("Referts")
        return { data: [{ lwin7: "1195121", name: "Jacques Carillon Les Referts", producer: "Jacques Carillon",
          region: "Burgundy", site: "Les Referts", parcel: null, color: "White", classification: "Premier Cru" }], error: null }
      }
      expect(name).toBe("reuse_drinking_window_profile_lwin")
      expect(parameters.p_confirmed).toBe(true)
      return { data: { lwin7: "1195121", product_id: "product-1", dates_staged: 0, wines_linked: 0, published: false }, error: null }
    }
    const matches = await searchProfileLwin("profile", "cuvee", "producer", " Referts ", { rpc })
    expect(matches[0]).toMatchObject({ lwin7: "1195121", site: "Les Referts" })
    await expect(reuseProfileLwin("profile", "cuvee", "producer", "1195121",
      "Verified producer, appellation, colour and cuvée in the source.", false, { rpc })).rejects.toThrow(/confirm/)
    await expect(reuseProfileLwin("profile", "cuvee", "producer", "1195121",
      "Verified producer, appellation, colour and cuvée in the source.", true, { rpc })).resolves.toBe("product-1")
  })
  it("stages only selected place-profile vintages, including additions to an existing group", async () => {
    const profile: FullProfileImport = { ...imported, kind: "appellation", name: "Saint-Véran" }
    const preview = await previewProfileStaging(profile, "draft-id", {}, { rpc: async (name) => {
      expect(name).toBe("preview_selectable_drinking_window_place_profile")
      return { data: { profile_id: profile.id, version_id: "draft-id", preview_sha256: "b".repeat(64),
        groups: [{ key: "white", status: "unchanged", name: "Village", color: "white", members: [],
          windows: [{ vintage: 2020, first_trial_year: 2021, best_start_year: 2023, best_end_year: 2029,
            selection_status: "unchanged" }, { vintage: 2021, first_trial_year: 2022,
            best_start_year: 2025, best_end_year: 2031, selection_status: "ready" }] }] }, error: null }
    } })
    expect(preview.items[0]?.children.map((item) => item.status)).toEqual(["unchanged", "ready"])
    const result = await stageSelectedProfileWindows(profile, preview,
      "A reviewed synthetic regional estimate for shared use.", true, {}, ["white:2021"], { rpc: async (name, params) => {
        expect(name).toBe("stage_selected_drinking_window_place_profile")
        expect(params.p_selected_keys).toEqual(["white:2021"])
        expect(params).not.toHaveProperty("p_identity_map")
        return { data: { staged: 1, unchanged: 0, quarantined: 0 }, error: null }
      } })
    expect(result.staged).toBe(1)
    await expect(stageSelectedProfileWindows(profile, preview,
      "A reviewed synthetic regional estimate for shared use.", true, {}, ["white:2020"]))
      .rejects.toThrow(/selected ready rows/)
  })
  it("loads curator-reviewed appellations for specific releases", async () => {
    const result = await getReviewedProfileMappings(imported, { rpc: async (name, parameters) => {
      expect(name).toBe("get_reviewed_profile_identity_mappings")
      expect(parameters).toEqual({ p_id: imported.id })
      return { data: { release_appellations: { "red|2002": "shared-appellation" },
        regions: { Languedoc: "shared-region" } }, error: null }
    } })
    expect(result).toEqual({ release_appellations: { "red|2002": "shared-appellation" },
      regions: { Languedoc: "shared-region" } })
  })
  it("accepts only read-only unique producer and cuvée suggestions", async () => {
    const result = await suggestProfileIdentities(imported, { rpc: async (name, parameters) => {
      expect(name).toBe("suggest_drinking_window_profile_identities")
      expect(parameters).toEqual({ p_id: imported.id })
      return { data: { profile_id: imported.id, producer_id: "shared-producer",
        producer_matches: 1, cuvees: { cote: "shared-product" },
        ambiguous_cuvees: ["rose"], published: false, wines_linked: 0 }, error: null }
    } })
    expect(result).toEqual({ map: { producer_id: "shared-producer",
      cuvees: { cote: "shared-product" } }, producerMatches: 1, ambiguousCuvees: ["rose"] })
    await expect(suggestProfileIdentities(imported, { rpc: async () => ({
      data: { profile_id: imported.id, producer_id: null, producer_matches: 0,
        cuvees: { cote: "shared-product" }, ambiguous_cuvees: [], published: false,
        wines_linked: 0 }, error: null,
    }) })).rejects.toThrow("Invalid producer suggestions")
  })
  it("parses read-only place suggestions without treating them as a mapping decision", async () => {
    const result = await suggestProfilePlaces(imported, {
      rpc: async (name, parameters) => {
        expect(name).toBe("suggest_drinking_window_profile_places")
        expect(parameters).toEqual({ p_id: imported.id })
        return { data: { regions: [{ kind: "region", source_name: "Bourgogne — Mâconnais",
          target_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", target_name: "Bourgogne",
          reason: "parent_region_prefix" }, { kind: "region", source_name: "Piémont",
          target_id: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", target_name: "Piemonte",
          reason: "existing_place_alias" }], appellations: [{ kind: "appellation",
          source_name: "Meursault 1er Cru", target_id: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", target_name: "Meursault",
          reason: "classification_parent_appellation" }] }, error: null }
      },
    })
    expect(result.regions).toEqual([{ kind: "region", sourceName: "Bourgogne — Mâconnais",
      targetId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb", targetName: "Bourgogne",
      reason: "parent_region_prefix" }, { kind: "region", sourceName: "Piémont",
      targetId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc", targetName: "Piemonte",
      reason: "existing_place_alias" }])
    expect(result.appellations).toEqual([{ kind: "appellation", sourceName: "Meursault 1er Cru",
      targetId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd", targetName: "Meursault",
      reason: "classification_parent_appellation" }])
  })
  it.skipIf(!process.env.CELLARMANAGER_PROFILE_AUDIT_DIR)("accepts every supplied audited producer profile", () => {
    const directory = process.env.CELLARMANAGER_PROFILE_AUDIT_DIR!
    const files = readdirSync(directory).filter((name) => name.endsWith(".json"))
    expect(files.length).toBeGreaterThan(0)
    const failures: string[] = []
    for (const file of files) {
      try {
        expect(previewFullProfileExchange(JSON.parse(readFileSync(join(directory, file), "utf8"))).kind)
          .toBe("producer")
      } catch (error) {
        failures.push(`${file}: ${String(error)}`)
      }
    }
    expect(failures).toEqual([])
  })
  it("accepts the three documented exchange templates without stripping optional facts", () => {
    expect(previewFullProfileExchange(producerTemplate).kind).toBe("producer")
    expect(previewFullProfileExchange(appellationTemplate).kind).toBe("appellation")
    expect(previewFullProfileExchange(regionTemplate).kind).toBe("region")
  })

  it("treats blank optional cuvée descriptions as absent without changing the uploaded file", () => {
    const document = structuredClone(producerTemplate) as unknown as Record<string, unknown>
    const cuvee = (document.cuvees as Record<string, unknown>[])[0]
    Object.assign(cuvee, { site_description: "", style_summary: "", grape: "" })
    const preview = previewFullProfileExchange(document)
    const normalizedCuvee = (preview.document.cuvees as Record<string, unknown>[])[0]
    expect(normalizedCuvee).not.toHaveProperty("site_description")
    expect(normalizedCuvee).not.toHaveProperty("style_summary")
    expect(normalizedCuvee).not.toHaveProperty("grape")
    expect(cuvee.site_description).toBe("")
  })

  it("rejects unsupported fields instead of silently discarding them", () => {
    expect(() => previewFullProfileExchange({ ...producerTemplate, invented: "discard me" }))
      .toThrow(/additional properties/i)
  })

  it("rejects missing source cross-references and duplicate releases", () => {
    const invalid = structuredClone(producerTemplate)
    invalid.producer.source_ids = ["missing"]
    expect(() => previewFullProfileExchange(invalid)).toThrow(/unknown source ID/)
  })

  it("rejects a context URL not belonging to the cited source IDs", () => {
    const invalid = structuredClone(producerTemplate) as unknown as Record<string, unknown>
    invalid.exact_release_calibrations = [{
      cuvee_id: "replace_cuvee_id", vintage: 2022, format_ml: 750,
      release_existence: { status: "confirmed_by_named_vintage_source",
        source_ids: ["replace_source_id"],
        source_urls: ["https://example.invalid/replace-with-real-source"] },
      proposal: { first_trial_year: 2025, best_start_year: 2028, best_end_year: 2035,
        date_origin: "curator_model_estimate_not_source_fact", confidence: "low",
        rationale: "Synthetic test dates", supporting_source_ids: ["replace_source_id"],
        review_status: "candidate_not_approved",
        supporting_source_urls: ["https://example.org/uncited"],
        milestone_support: { first_trial_year: "modelled", best_start_year: "modelled",
          best_end_year: "modelled" } },
    }]
    expect(() => previewFullProfileExchange(invalid)).toThrow(/context URL must belong/)
  })

  it("rejects inverted place-window years and duplicate group vintages", () => {
    const invalid = structuredClone(regionTemplate) as unknown as Record<string, unknown>
    invalid.ageing_groups = [{
      id: "test", name: "Test group", color: "red",
      definition: "A deliberately synthetic reviewed region group for validation.",
      source_ids: ["replace_source_id"],
      members: [{ kind: "place", name: "Synthetic place",
        rationale: "An explicitly reviewed synthetic place membership for the test.",
        source_ids: ["replace_source_id"] }],
      windows: [{ vintage: 2022, first_trial_year: 2025,
        best_start_year: 2024, best_end_year: 2030,
        rationale: "An intentionally inverted window that must never enter the shared reference.",
        date_origin: "curator_model_estimate_not_source_fact", confidence: "low",
        source_ids: ["replace_source_id"], review_status: "candidate_not_approved" }],
    }]
    expect(() => previewFullProfileExchange(invalid)).toThrow(/ordered/)
  })

  it("sends the complete document to the curator-only import, not a compact candidate", async () => {
    let supplied: unknown
    const result = await importFullProfileExchange(producerTemplate, {
      rpc: async (name, parameters) => {
        expect(name).toBe("import_drinking_window_profile_exchange")
        supplied = parameters.p_document
        return { data: { id: imported.id, document_sha256: imported.documentSha256,
          profile_kind: "producer", profile_name: imported.name,
          dataset_version: imported.datasetVersion }, error: null }
      },
    })
    expect(result.id).toBe(imported.id)
    expect(supplied).toEqual(producerTemplate)
  })

  it("reports ready, unchanged and quarantined rows and carries explicit identity mapping", async () => {
    const mapping = { producer_id: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
      cuvees: { james: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" } }
    const hash = "b".repeat(64)
    const preview = await previewProfileStaging(imported, "draft-id", mapping, {
      rpc: async (name, parameters) => {
        expect(name).toBe("preview_drinking_window_profile_exchange")
        expect(parameters.p_identity_map).toEqual(mapping)
        return { data: { profile_id: imported.id, version_id: "draft-id", preview_sha256: hash,
          rows: [
            { key: "james · 2022 · 750 ml", status: "ready", reason: null,
              cuvee: "James", vintage: "2022", format_ml: "750",
              first_trial_year: "2025", best_start_year: "2028", best_end_year: "2035",
              source_urls: ["https://example.org/context"] },
            { key: "james · 2023 · 750 ml", status: "quarantined",
              reason: "Release has no unique canonical identity" },
          ] }, error: null }
      },
    })
    expect(preview.ready).toBe(1)
    expect(preview.quarantined).toBe(1)
    expect(preview.items[0]?.firstTrialYear).toBe(2025)
    await expect(stageProfileExchange(imported, preview, "too brief", true, mapping))
      .rejects.toThrow(/Review the ready rows/)
  })

  it("keeps identity creation separate from drinking-date staging and rejects a changed preview", async () => {
    const keys = ["james|2022"]
    const preview = await previewProfileIdentityBatch(imported, {}, keys, {
      rpc: async (name, parameters) => {
        expect(name).toBe("preview_drinking_window_profile_identity_batch")
        expect(parameters.p_release_keys).toEqual(keys)
        return { data: {
          profile_id: imported.id, plan_sha256: "b".repeat(64), status: "ready",
          producer_name: "Example", producer_status: "existing",
          entries: [{ key: keys[0], cuvee_id: "james", cuvee_name: "James",
            vintage: "2022", product_status: "existing", release_status: "create",
            source_urls: ["https://example.org/release"], reason: null }],
        }, error: null }
      },
    })
    expect(preview.entries[0]?.sourceUrls).toEqual(["https://example.org/release"])
    await expect(createProfileIdentityBatch(imported, {}, keys,
      { ...preview, status: "blocked" }, "I checked the release existence and identity carefully.", true))
      .rejects.toThrow(/Review and confirm/)
    const result = await createProfileIdentityBatch(imported, {}, keys, preview,
      "I checked the release existence and identity carefully.", true, {
        rpc: async (name, parameters) => {
          expect(name).toBe("create_drinking_window_profile_identity_batch")
          expect(parameters.p_expected_plan_sha256).toBe("b".repeat(64))
          expect(parameters.p_confirmed).toBe(true)
          return { data: { created_producers: 0, created_products: 0, created_releases: 1,
            dates_staged: 0, wines_linked: 0, published: false }, error: null }
        },
      })
    expect(result).toEqual({ createdProducers: 0, createdProducts: 0,
      createdReleases: 1, datesStaged: 0, winesLinked: 0, published: false })
  })
})
