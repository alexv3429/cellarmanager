import { describe, expect, it } from "vitest"
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

import appellationTemplate from "../../../../docs/examples/appellation-profile-template.json"
import producerTemplate from "../../../../docs/examples/producer-research-template.json"
import regionTemplate from "../../../../docs/examples/region-profile-template.json"
import {
  importFullProfileExchange,
  previewFullProfileExchange,
  previewProfileStaging,
  stageProfileExchange,
  type FullProfileImport,
} from "./drinkingWindowProfileExchange"

const imported: FullProfileImport = {
  id: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
  documentSha256: "a".repeat(64), kind: "producer", name: "Example",
  schemaVersion: "1.1.0", datasetVersion: "1.0.0", releaseCount: 1,
  submittedAt: "2026-10-30T00:00:00Z",
}

describe("complete profile exchange", () => {
  it.skipIf(!process.env.CELLARMANAGER_PROFILE_AUDIT_DIR)("accepts every supplied audited producer profile", () => {
    const directory = process.env.CELLARMANAGER_PROFILE_AUDIT_DIR!
    const files = readdirSync(directory).filter((name) => name.endsWith(".json"))
    expect(files).toHaveLength(23)
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
})
