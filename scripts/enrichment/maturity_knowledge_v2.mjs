#!/usr/bin/env node

import { readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
export const defaultKnowledgePath = resolve(
  scriptDirectory,
  "maturity_knowledge_v2.json",
);
const defaultMigrationPath = resolve(
  scriptDirectory,
  "../../supabase/migrations/20260822110000_expanded_maturity_knowledge.sql",
);
const baseMigrationPath = resolve(
  scriptDirectory,
  "../../supabase/migrations/20260822090000_maturity_projections.sql",
);

const wineColors = new Set([
  "red",
  "white",
  "rose",
  "sparkling",
  "sweet",
  "fortified",
  "other",
]);
const placeTypes = new Set([
  "country",
  "region",
  "subregion",
  "appellation",
  "classification",
  "site",
  "parcel",
  "other",
]);
const structureFields = [
  "body",
  "acidity",
  "tannin",
  "sweetness",
  "alcohol",
  "freshness",
  "savory",
];

export function normalizeWineText(value) {
  return String(value ?? "")
    .normalize("NFD")
    .replaceAll("œ", "oe")
    .replaceAll("Œ", "OE")
    .replace(/\p{M}/gu, "")
    .toLocaleLowerCase("en-US")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function requireNonEmptyText(value, field, errors) {
  if (typeof value !== "string" || value.trim().length === 0) {
    errors.push(`${field} must be non-empty text`);
  }
}

function requireNumberInRange(value, minimum, maximum, field, errors) {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < minimum ||
    value > maximum
  ) {
    errors.push(`${field} must be between ${minimum} and ${maximum}`);
  }
}

export function validateMaturityKnowledge(value) {
  const errors = [];
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error("Maturity knowledge must be a JSON object");
  }

  if (value.schemaVersion !== 1) {
    errors.push("schemaVersion must be 1");
  }
  if (value.knowledgeVersion !== 2) {
    errors.push("knowledgeVersion must be 2");
  }
  requireNonEmptyText(value.modelVersion, "modelVersion", errors);
  requireNonEmptyText(value.label, "label", errors);
  requireNonEmptyText(value.reviewedOn, "reviewedOn", errors);
  requireNonEmptyText(value.methodologyUrl, "methodologyUrl", errors);

  for (const field of ["sources", "archetypes", "places", "vintageProfiles"]) {
    if (!Array.isArray(value[field])) {
      errors.push(`${field} must be an array`);
    }
  }
  if (errors.length > 0) {
    throw new Error(`Invalid maturity knowledge:\n- ${errors.join("\n- ")}`);
  }

  const sourceIds = new Set();
  for (const [index, source] of value.sources.entries()) {
    requireNonEmptyText(source.id, `sources[${index}].id`, errors);
    requireNonEmptyText(source.name, `sources[${index}].name`, errors);
    requireNonEmptyText(source.usage, `sources[${index}].usage`, errors);
    if (sourceIds.has(source.id)) {
      errors.push(`duplicate source id: ${source.id}`);
    }
    sourceIds.add(source.id);
    if (source.url !== null && !String(source.url).startsWith("https://")) {
      errors.push(`source ${source.id} URL must use https`);
    }
  }

  const archetypes = new Map();
  for (const [index, archetype] of value.archetypes.entries()) {
    const field = `archetypes[${index}]`;
    requireNonEmptyText(archetype.id, `${field}.id`, errors);
    if (archetypes.has(archetype.id)) {
      errors.push(`duplicate archetype id: ${archetype.id}`);
    }
    archetypes.set(archetype.id, archetype);
    for (const age of ["first", "bestStart", "bestEnd", "outer"]) {
      requireNumberInRange(archetype[age], 0, 100, `${field}.${age}`, errors);
      if (!Number.isInteger(archetype[age])) {
        errors.push(`${field}.${age} must be an integer`);
      }
    }
    if (
      archetype.first > archetype.bestStart ||
      archetype.bestStart > archetype.bestEnd ||
      archetype.bestEnd > archetype.outer
    ) {
      errors.push(`${field} ages must be monotonic`);
    }
    for (const structure of structureFields) {
      requireNumberInRange(
        archetype[structure],
        0,
        5,
        `${field}.${structure}`,
        errors,
      );
    }
    requireNumberInRange(archetype.confidence, 0, 1, `${field}.confidence`, errors);
    requireNonEmptyText(archetype.rationale, `${field}.rationale`, errors);
    if (!Array.isArray(archetype.sources) || archetype.sources.length === 0) {
      errors.push(`${field}.sources must contain at least one source`);
    } else {
      for (const sourceId of archetype.sources) {
        if (!sourceIds.has(sourceId)) {
          errors.push(`${field} references unknown source: ${sourceId}`);
        }
      }
    }
  }

  const places = new Map();
  const placePositions = new Map();
  const aliases = new Map();
  let placeProfileCount = 0;
  for (const [index, place] of value.places.entries()) {
    const field = `places[${index}]`;
    requireNonEmptyText(place.id, `${field}.id`, errors);
    requireNonEmptyText(place.name, `${field}.name`, errors);
    if (places.has(place.id)) {
      errors.push(`duplicate place id: ${place.id}`);
    }
    places.set(place.id, place);
    placePositions.set(place.id, index);
    if (!placeTypes.has(place.type)) {
      errors.push(`${field}.type is unsupported: ${place.type}`);
    }
    if (!/^[A-Z]{2}$/.test(place.country ?? "")) {
      errors.push(`${field}.country must be a two-letter uppercase code`);
    }
    if (!Array.isArray(place.aliases) || place.aliases.length === 0) {
      errors.push(`${field}.aliases must contain at least one alias`);
    } else {
      for (const alias of place.aliases) {
        const normalized = normalizeWineText(alias);
        if (!normalized) {
          errors.push(`${field} contains an empty normalized alias`);
        } else if (aliases.has(normalized) && aliases.get(normalized) !== place.id) {
          errors.push(
            `alias collision: ${JSON.stringify(alias)} resolves to both ${aliases.get(normalized)} and ${place.id}`,
          );
        } else {
          aliases.set(normalized, place.id);
        }
      }
    }
    if (
      typeof place.profiles !== "object" ||
      place.profiles === null ||
      Array.isArray(place.profiles)
    ) {
      errors.push(`${field}.profiles must be an object`);
    } else {
      for (const [color, archetypeId] of Object.entries(place.profiles)) {
        placeProfileCount += 1;
        if (!wineColors.has(color)) {
          errors.push(`${field}.profiles has unsupported color: ${color}`);
        }
        if (!archetypes.has(archetypeId)) {
          errors.push(`${field}.profiles references unknown archetype: ${archetypeId}`);
        }
      }
    }
  }

  for (const place of value.places) {
    if (place.parent !== null && !places.has(place.parent)) {
      errors.push(`place ${place.id} references unknown parent: ${place.parent}`);
    } else if (
      place.parent !== null &&
      placePositions.get(place.parent) > placePositions.get(place.id)
    ) {
      errors.push(`place ${place.id} must appear after its parent ${place.parent}`);
    }
    const ancestors = new Set([place.id]);
    let parent = place.parent;
    while (parent !== null && places.has(parent)) {
      if (ancestors.has(parent)) {
        errors.push(`place hierarchy cycle involving ${place.id}`);
        break;
      }
      ancestors.add(parent);
      parent = places.get(parent).parent;
    }
  }

  const vintageKeys = new Set();
  for (const [index, vintage] of value.vintageProfiles.entries()) {
    const field = `vintageProfiles[${index}]`;
    if (!places.has(vintage.place)) {
      errors.push(`${field} references unknown place: ${vintage.place}`);
    }
    if (!wineColors.has(vintage.color)) {
      errors.push(`${field}.color is unsupported: ${vintage.color}`);
    }
    requireNumberInRange(vintage.vintage, 1800, 2200, `${field}.vintage`, errors);
    if (!Number.isInteger(vintage.vintage)) {
      errors.push(`${field}.vintage must be an integer`);
    }
    for (const adjustment of ["opening", "longevity"]) {
      requireNumberInRange(vintage[adjustment], -50, 50, `${field}.${adjustment}`, errors);
      if (!Number.isInteger(vintage[adjustment])) {
        errors.push(`${field}.${adjustment} must be an integer`);
      }
    }
    for (const structure of structureFields) {
      requireNumberInRange(
        vintage[structure] ?? 0,
        -5,
        5,
        `${field}.${structure}`,
        errors,
      );
    }
    requireNumberInRange(vintage.confidence, 0, 1, `${field}.confidence`, errors);
    requireNonEmptyText(vintage.rationale, `${field}.rationale`, errors);
    const key = `${vintage.place}:${vintage.color}:${vintage.vintage}`;
    if (vintageKeys.has(key)) {
      errors.push(`duplicate vintage profile: ${key}`);
    }
    vintageKeys.add(key);
  }

  if (errors.length > 0) {
    throw new Error(`Invalid maturity knowledge:\n- ${errors.join("\n- ")}`);
  }

  return {
    aliasCount: aliases.size,
    archetypeCount: archetypes.size,
    placeCount: places.size,
    placeProfileCount,
    sourceCount: sourceIds.size,
    vintageProfileCount: vintageKeys.size,
  };
}

export function assessKnowledgeCoverage(knowledge, groupedWines) {
  validateMaturityKnowledge(knowledge);
  if (!Array.isArray(groupedWines)) {
    throw new Error("Coverage input must be an array of grouped wines");
  }

  const places = new Map(knowledge.places.map((place) => [place.id, place]));
  const aliasToPlace = new Map();
  for (const place of knowledge.places) {
    for (const alias of place.aliases) {
      aliasToPlace.set(normalizeWineText(alias), place.id);
    }
  }

  const totals = { wines: 0, bottles: 0 };
  const covered = { wines: 0, bottles: 0 };
  const reasons = new Map();
  const remaining = [];
  for (const group of groupedWines) {
    const wines = Number(group.wines ?? 0);
    const bottles = Number(group.bottles ?? 0);
    totals.wines += wines;
    totals.bottles += bottles;
    const placeId = aliasToPlace.get(normalizeWineText(group.appellation));
    const place = placeId ? places.get(placeId) : null;
    let reason = null;
    if (Number(group.vintage_count ?? 0) === 0) {
      reason = "missing-vintage";
    } else if (!place) {
      reason = "unsupported-place-profile";
    } else if (!place.profiles[group.color]) {
      reason = "appellation-color-conflict";
    }

    if (reason === null) {
      covered.wines += wines;
      covered.bottles += bottles;
    } else {
      const current = reasons.get(reason) ?? { wines: 0, bottles: 0, groups: 0 };
      current.wines += wines;
      current.bottles += bottles;
      current.groups += 1;
      reasons.set(reason, current);
      remaining.push({ ...group, reason });
    }
  }

  return {
    totals,
    covered,
    remaining: remaining.sort((left, right) => right.bottles - left.bottles),
    reasons: Object.fromEntries(reasons),
    wineCoverage: totals.wines === 0 ? 1 : covered.wines / totals.wines,
    bottleCoverage: totals.bottles === 0 ? 1 : covered.bottles / totals.bottles,
  };
}

function extractSqlFunction(sql, signature) {
  const start = sql.indexOf(`create or replace function ${signature}`);
  if (start < 0) {
    throw new Error(`Unable to find SQL function ${signature}`);
  }
  const end = sql.indexOf("\n$$;", start);
  if (end < 0) {
    throw new Error(`Unable to find end of SQL function ${signature}`);
  }
  return sql.slice(start, end + 4);
}

function replaceOnce(value, before, after, label) {
  const first = value.indexOf(before);
  if (first < 0 || value.indexOf(before, first + before.length) >= 0) {
    throw new Error(`Expected one ${label} block while generating SQL`);
  }
  return value.replace(before, after);
}

function sqlKnowledgeLiteral(knowledge) {
  return JSON.stringify(knowledge).replaceAll("$knowledge$", "$ knowledge $");
}

export function renderExpandedKnowledgeMigration(knowledge, baseMigrationSql) {
  const counts = validateMaturityKnowledge(knowledge);
  let calculator = extractSqlFunction(
    baseMigrationSql,
    "private.calculate_maturity_projection(",
  );
  const fallbackStart = `    if not found then\n        v_place_match := 'area-fallback';`;
  const fallbackEnd = `    with recursive ancestors(place_id, depth) as (`;
  const fallbackStartIndex = calculator.indexOf(fallbackStart);
  const fallbackEndIndex = calculator.indexOf(fallbackEnd, fallbackStartIndex);
  if (fallbackStartIndex < 0 || fallbackEndIndex < 0) {
    throw new Error("Unable to remove the broad area fallback from calculator");
  }
  calculator = `${calculator.slice(0, fallbackStartIndex)}    if not found then
        return jsonb_build_object(
            'status', 'needs-review',
            'reason', case
                when v_color_conflict then 'appellation-color-conflict'
                else 'unsupported-place-profile'
            end
        );
    end if;

${calculator.slice(fallbackEndIndex)}`;
  calculator = calculator
    .replace("    v_place_match text := 'appellation';\n", "    v_place_match text := 'exact-appellation';\n")
    .replace("    v_place_match text := 'exact-appellation';\n", "    v_place_match text := 'exact-appellation';\n");
  calculator = replaceOnce(
    calculator,
    `    v_confidence := round((
        v_place.profile_confidence * 0.45
        + coalesce(v_vintage.profile_confidence, 0.20) * 0.20
        + coalesce(v_producer.profile_confidence, 0.20) * 0.15
        + coalesce(v_cuvee.profile_confidence, 0.20) * 0.20
        - jsonb_array_length(v_warnings) * 0.06
    )::numeric, 3);
    v_confidence := greatest(0, least(1, v_confidence));
    v_confidence_label := case
        when v_confidence >= 0.80 then 'high'
        when v_confidence >= 0.60 then 'medium'
        else 'low'
    end;`,
    `    -- Missing layers contribute no confidence. They are not counted once at a
    -- low default and then penalized a second time as warnings.
    v_confidence := round((
        v_place.profile_confidence * 0.55
        + coalesce(v_vintage.profile_confidence, 0) * 0.25
        + coalesce(v_producer.profile_confidence, 0) * 0.10
        + coalesce(v_cuvee.profile_confidence, 0) * 0.10
    )::numeric, 3);
    v_confidence := greatest(0, least(1, v_confidence));
    v_confidence_label := case
        when v_confidence >= 0.75 then 'high'
        when v_confidence >= 0.50 then 'medium'
        else 'low'
    end;`,
    "confidence calculation",
  );

  let overview = extractSqlFunction(
    baseMigrationSql,
    "public.get_household_maturity_overview(",
  );
  overview = replaceOnce(
    overview,
    "            demand.demand_status,\n            feedback.verdict as feedback_verdict",
    "            demand.demand_status,\n            demand.last_error_code as assessment_reason,\n            feedback.verdict as feedback_verdict",
    "overview demand fields",
  );
  overview = replaceOnce(
    overview,
    "                'demand_status', row.demand_status,\n                'feedback_verdict', row.feedback_verdict,",
    "                'demand_status', row.demand_status,\n                'assessment_reason', row.assessment_reason,\n                'feedback_verdict', row.feedback_verdict,",
    "overview response fields",
  );

  let detail = extractSqlFunction(baseMigrationSql, "public.get_wine_maturity(");
  detail = replaceOnce(
    detail,
    "        'demand_status', demand.demand_status,\n        'projection', case",
    "        'demand_status', demand.demand_status,\n        'assessment_reason', demand.last_error_code,\n        'projection', case",
    "wine detail response fields",
  );

  let processor = extractSqlFunction(
    baseMigrationSql,
    "public.process_maturity_enrichment_jobs(",
  );
  processor = replaceOnce(
    processor,
    `                perform public.complete_enrichment_job(
                    v_claim.job_id,
                    v_claim.lease_token,
                    'not-found'
                );
                v_not_found := v_not_found + 1;`,
    `                perform public.complete_enrichment_job(
                    v_claim.job_id,
                    v_claim.lease_token,
                    'not-found'
                );
                perform private.record_maturity_assessment_reason(
                    v_claim.job_id,
                    v_claim.demand_id,
                    v_result ->> 'reason'
                );
                v_not_found := v_not_found + 1;`,
    "not-found reason recording",
  );
  processor = replaceOnce(
    processor,
    `                perform public.complete_enrichment_job(
                    v_claim.job_id,
                    v_claim.lease_token,
                    'needs-review'
                );
                v_needs_review := v_needs_review + 1;`,
    `                perform public.complete_enrichment_job(
                    v_claim.job_id,
                    v_claim.lease_token,
                    'needs-review'
                );
                perform private.record_maturity_assessment_reason(
                    v_claim.job_id,
                    v_claim.demand_id,
                    v_result ->> 'reason'
                );
                v_needs_review := v_needs_review + 1;`,
    "needs-review reason recording",
  );

  const knowledgeLiteral = sqlKnowledgeLiteral(knowledge);
  return `-- Generated by scripts/enrichment/maturity_knowledge_v2.mjs.
-- Edit maturity_knowledge_v2.json and regenerate; do not hand-edit seed data.
begin;

create or replace function public.install_expanded_maturity_knowledge()
returns jsonb
language plpgsql
security definer
set search_path = ''
as $install$
declare
    v_source_id uuid := private.enrichment_seed_uuid('source:cellarmanager-maturity-v2');
    v_policy_id uuid := private.enrichment_seed_uuid('policy:cellarmanager-maturity-v2');
    v_evidence_id uuid := private.enrichment_seed_uuid('evidence:maturity-knowledge-v2');
    v_version_id uuid := private.enrichment_seed_uuid('knowledge:maturity-v2');
    v_knowledge jsonb := $knowledge$${knowledgeLiteral}$knowledge$::jsonb;
    v_place record;
    v_mapping record;
    v_archetype record;
    v_vintage record;
    v_place_id uuid;
    v_profile_id uuid;
    v_result jsonb;
begin
    if exists (
        select 1
        from public.enrichment_knowledge_versions version
        where version.id = v_version_id
          and version.status in ('active', 'superseded', 'retired')
    ) then
        select jsonb_build_object(
            'knowledge_version_id', version.id,
            'status', version.status,
            'content_sha256', version.content_sha256,
            'already_installed', true
        )
        into v_result
        from public.enrichment_knowledge_versions version
        where version.id = v_version_id;

        return v_result;
    end if;

    if exists (
        select 1
        from public.enrichment_knowledge_versions version
        where version.version_number = 2
          and version.id <> v_version_id
    ) then
        raise exception using
            errcode = '23505',
            message = 'Knowledge version 2 is already used by another model';
    end if;

    insert into public.enrichment_sources (
        id,
        source_key,
        source_name,
        source_kind,
        homepage_url
    )
    values (
        v_source_id,
        'cellarmanager-maturity-v2',
        'CellarManager expanded maturity model',
        'cellarmanager',
        'https://github.com/alexv3429/cellarmanager'
    )
    on conflict (id) do nothing;

    insert into public.enrichment_source_policies (
        id,
        source_id,
        policy_version,
        status,
        effective_from,
        terms_checked_on,
        evidence_url,
        display_right,
        normalized_storage_right,
        raw_payload_storage_right,
        offline_sync_right,
        retention_right,
        cross_household_reuse_right,
        attribution_text,
        notes
    )
    values (
        v_policy_id,
        v_source_id,
        1,
        'reviewed',
        '${knowledge.reviewedOn}',
        '${knowledge.reviewedOn}',
        '${knowledge.methodologyUrl}',
        'allowed',
        'allowed',
        'prohibited',
        'allowed',
        'allowed',
        'allowed',
        'CellarManager expanded maturity model',
        'CellarManager owns the derived model. Public sources and a private owner workbook are calibration inputs, not copied drinking-window claims.'
    )
    on conflict (id) do nothing;

    insert into public.enrichment_evidence (
        id,
        source_id,
        source_policy_id,
        source_record_id,
        source_record_url,
        content_mode,
        claim_type,
        scope_level,
        review_status,
        reviewed_at,
        source_published_on
    )
    values (
        v_evidence_id,
        v_source_id,
        v_policy_id,
        'docs/maturity-knowledge-v2.md',
        '${knowledge.methodologyUrl}',
        'pointer-only',
        'methodology',
        'methodology',
        'reviewed',
        '${knowledge.reviewedOn}T09:00:00Z',
        '${knowledge.reviewedOn}'
    )
    on conflict (id) do nothing;

    insert into public.enrichment_knowledge_versions (
        id,
        version_number,
        label,
        model_key,
        model_version
    )
    values (
        v_version_id,
        2,
        '${knowledge.label.replaceAll("'", "''")}',
        'curated-inference',
        '${knowledge.modelVersion.replaceAll("'", "''")}'
    )
    on conflict (id) do nothing;

    for v_place in
        select
            value ->> 'id' as key,
            value ->> 'parent' as parent,
            value ->> 'type' as type,
            value ->> 'name' as name,
            value ->> 'country' as country,
            value -> 'aliases' as aliases,
            value -> 'profiles' as profiles
        from jsonb_array_elements(v_knowledge -> 'places') with ordinality seed(value, position)
        order by position
    loop
        if v_place.parent is not null
           and not exists (
               select 1
               from public.enrichment_places parent
               where parent.id = private.enrichment_seed_uuid('place:' || v_place.parent)
           )
        then
            raise exception using
                errcode = '23503',
                message = format('Maturity place parent %s must precede %s', v_place.parent, v_place.key);
        end if;

        v_place_id := private.enrichment_seed_uuid('place:' || v_place.key);
        insert into public.enrichment_places (
            id,
            parent_id,
            place_type,
            canonical_name,
            country_code
        )
        values (
            v_place_id,
            case
                when v_place.parent is null then null
                else private.enrichment_seed_uuid('place:' || v_place.parent)
            end,
            v_place.type,
            v_place.name,
            v_place.country
        )
        on conflict (id) do nothing;

        insert into public.enrichment_place_aliases (place_id, alias_value)
        select v_place_id, alias.value
        from jsonb_array_elements_text(v_place.aliases) alias(value)
        on conflict (normalized_value) do nothing;

        for v_mapping in
            select key as color, value as archetype_id
            from jsonb_each_text(v_place.profiles)
        loop
            select
                (value ->> 'first')::integer as first_age,
                (value ->> 'bestStart')::integer as best_start_age,
                (value ->> 'bestEnd')::integer as best_end_age,
                (value ->> 'outer')::integer as outer_age,
                (value ->> 'body')::numeric as body,
                (value ->> 'acidity')::numeric as acidity,
                (value ->> 'tannin')::numeric as tannin,
                (value ->> 'sweetness')::numeric as sweetness,
                (value ->> 'alcohol')::numeric as alcohol,
                (value ->> 'freshness')::numeric as freshness,
                (value ->> 'savory')::numeric as savory,
                (value ->> 'confidence')::numeric as confidence,
                value ->> 'rationale' as rationale
            into v_archetype
            from jsonb_array_elements(v_knowledge -> 'archetypes') seed(value)
            where value ->> 'id' = v_mapping.archetype_id;

            if not found then
                raise exception using
                    errcode = '23503',
                    message = format('Unknown maturity archetype %s', v_mapping.archetype_id);
            end if;

            v_profile_id := private.enrichment_seed_uuid(
                format('profile:maturity-v2:%s:%s', v_place.key, v_mapping.color)
            );
            insert into public.enrichment_profiles (
                id,
                knowledge_version_id,
                profile_type,
                review_status,
                confidence,
                rationale,
                reviewed_at
            )
            values (
                v_profile_id,
                v_version_id,
                'place',
                'reviewed',
                v_archetype.confidence,
                v_archetype.rationale,
                '${knowledge.reviewedOn}T09:00:00Z'
            )
            on conflict (id) do nothing;

            insert into public.enrichment_place_profiles (
                profile_id,
                knowledge_version_id,
                place_id,
                wine_color,
                first_trial_age,
                best_start_age,
                best_end_age,
                outer_horizon_age,
                body,
                acidity,
                tannin,
                sweetness,
                alcohol,
                freshness,
                savory
            )
            values (
                v_profile_id,
                v_version_id,
                v_place_id,
                v_mapping.color,
                v_archetype.first_age,
                v_archetype.best_start_age,
                v_archetype.best_end_age,
                v_archetype.outer_age,
                v_archetype.body,
                v_archetype.acidity,
                v_archetype.tannin,
                v_archetype.sweetness,
                v_archetype.alcohol,
                v_archetype.freshness,
                v_archetype.savory
            )
            on conflict (profile_id) do nothing;

            insert into public.enrichment_profile_evidence (
                profile_id,
                evidence_id,
                evidence_role
            )
            values (v_profile_id, v_evidence_id, 'supports')
            on conflict do nothing;
        end loop;
    end loop;

    for v_vintage in
        select
            value ->> 'place' as place,
            value ->> 'color' as color,
            (value ->> 'vintage')::integer as vintage,
            (value ->> 'opening')::integer as opening,
            (value ->> 'longevity')::integer as longevity,
            coalesce((value ->> 'body')::numeric, 0) as body,
            coalesce((value ->> 'acidity')::numeric, 0) as acidity,
            coalesce((value ->> 'tannin')::numeric, 0) as tannin,
            coalesce((value ->> 'sweetness')::numeric, 0) as sweetness,
            coalesce((value ->> 'alcohol')::numeric, 0) as alcohol,
            coalesce((value ->> 'freshness')::numeric, 0) as freshness,
            coalesce((value ->> 'savory')::numeric, 0) as savory,
            (value ->> 'confidence')::numeric as confidence,
            value ->> 'rationale' as rationale
        from jsonb_array_elements(v_knowledge -> 'vintageProfiles') seed(value)
    loop
        v_place_id := private.enrichment_seed_uuid('place:' || v_vintage.place);
        v_profile_id := private.enrichment_seed_uuid(
            format(
                'profile:maturity-v2:%s:%s:%s',
                v_vintage.place,
                v_vintage.color,
                v_vintage.vintage
            )
        );

        insert into public.enrichment_profiles (
            id,
            knowledge_version_id,
            profile_type,
            review_status,
            confidence,
            rationale,
            reviewed_at
        )
        values (
            v_profile_id,
            v_version_id,
            'vintage',
            'reviewed',
            v_vintage.confidence,
            v_vintage.rationale,
            '${knowledge.reviewedOn}T09:00:00Z'
        )
        on conflict (id) do nothing;

        insert into public.enrichment_vintage_profiles (
            profile_id,
            knowledge_version_id,
            place_id,
            vintage_year,
            wine_color,
            first_trial_age_adjustment,
            best_start_age_adjustment,
            best_end_age_adjustment,
            outer_horizon_age_adjustment,
            body_adjustment,
            acidity_adjustment,
            tannin_adjustment,
            sweetness_adjustment,
            alcohol_adjustment,
            freshness_adjustment,
            savory_adjustment
        )
        values (
            v_profile_id,
            v_version_id,
            v_place_id,
            v_vintage.vintage,
            v_vintage.color,
            v_vintage.opening,
            v_vintage.opening,
            v_vintage.longevity,
            v_vintage.longevity,
            v_vintage.body,
            v_vintage.acidity,
            v_vintage.tannin,
            v_vintage.sweetness,
            v_vintage.alcohol,
            v_vintage.freshness,
            v_vintage.savory
        )
        on conflict (profile_id) do nothing;

        insert into public.enrichment_profile_evidence (
            profile_id,
            evidence_id,
            evidence_role
        )
        values (v_profile_id, v_evidence_id, 'supports')
        on conflict do nothing;
    end loop;

    return public.publish_enrichment_knowledge_version(v_version_id)
        || jsonb_build_object(
            'already_installed', false,
            'place_count', ${counts.placeCount},
            'place_profile_count', ${counts.placeProfileCount},
            'vintage_profile_count', ${counts.vintageProfileCount}
        );
end;
$install$;

comment on function public.install_expanded_maturity_knowledge() is
    'Idempotently installs and atomically publishes the reviewed appellation-first maturity knowledge v2.';

revoke execute
on function public.install_expanded_maturity_knowledge()
from public, anon, authenticated;

grant execute
on function public.install_expanded_maturity_knowledge()
to service_role;


-- A terminal needs-review result keeps its explicit cause for the household UI.
create or replace function private.record_maturity_assessment_reason(
    p_job_id uuid,
    p_demand_id uuid,
    p_reason text
)
returns void
language plpgsql
security definer
set search_path = ''
as $reason$
begin
    if p_reason is null or p_reason not in (
        'wine-not-found',
        'missing-vintage',
        'appellation-color-conflict',
        'unsupported-place-profile'
    ) then
        raise exception using
            errcode = '22023',
            message = 'Unsupported maturity assessment reason';
    end if;

    update public.enrichment_jobs job
    set last_error_code = p_reason,
        updated_at = now()
    where job.id = p_job_id
      and job.demand_id = p_demand_id
      and job.capability = 'maturity'
      and job.job_status in ('succeeded', 'not-found');

    update public.enrichment_demands demand
    set last_error_code = p_reason,
        updated_at = now()
    where demand.id = p_demand_id
      and demand.capability = 'maturity'
      and demand.demand_status in ('needs-review', 'not-found');
end;
$reason$;

revoke execute
on function private.record_maturity_assessment_reason(uuid, uuid, text)
from public, anon, authenticated;

grant execute
on function private.record_maturity_assessment_reason(uuid, uuid, text)
to service_role;


-- Only an exact reviewed appellation/color alias may create a projection.
-- Broad area fallbacks remain intentionally unsupported.
${calculator}


${overview}


${detail}


${processor}

commit;
`;
}

export async function loadMaturityKnowledge(path = defaultKnowledgePath) {
  const value = JSON.parse(await readFile(path, "utf8"));
  validateMaturityKnowledge(value);
  return value;
}

function parseOptions(argv) {
  const options = {
    knowledge: defaultKnowledgePath,
    coverage: null,
    writeSql: null,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const option = argv[index];
    if (option === "--write-sql") {
      const next = argv[index + 1];
      options.writeSql = next && !next.startsWith("--") ? resolve(next) : defaultMigrationPath;
      if (next && !next.startsWith("--")) index += 1;
    } else if (option === "--knowledge" || option === "--coverage") {
      const next = argv[index + 1];
      if (!next) throw new Error(`${option} requires a path`);
      options[option.slice(2)] = resolve(next);
      index += 1;
    } else {
      throw new Error(
        "Usage: maturity_knowledge_v2.mjs [--knowledge <json>] [--coverage <private-grouped-json>] [--write-sql [path]]",
      );
    }
  }
  return options;
}

async function main() {
  const options = parseOptions(process.argv.slice(2));
  const knowledge = await loadMaturityKnowledge(options.knowledge);
  const counts = validateMaturityKnowledge(knowledge);
  console.log(
    `Maturity knowledge v2 valid: ${counts.placeProfileCount} place profiles, ${counts.vintageProfileCount} vintage profiles, ${counts.aliasCount} aliases.`,
  );

  if (options.coverage) {
    const groupedWines = JSON.parse(await readFile(options.coverage, "utf8"));
    const coverage = assessKnowledgeCoverage(knowledge, groupedWines);
    console.log(JSON.stringify(coverage, null, 2));
  }

  if (options.writeSql) {
    const baseMigrationSql = await readFile(baseMigrationPath, "utf8");
    await writeFile(
      options.writeSql,
      renderExpandedKnowledgeMigration(knowledge, baseMigrationSql),
      "utf8",
    );
    console.log(`Generated ${options.writeSql}`);
  }
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
