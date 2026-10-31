import { readFile, readdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateProducerResearchPackage } from './producer_research_package.mjs';

// Generates a private, rollback-only psql script. Never commit its output:
// it contains the full owner-supplied research documents and source pointers.
export function buildImportRehearsal(files) {
  const names = Object.keys(files).sort();
  let proposals = 0;
  const statements = [];
  for (const [index, name] of names.entries()) {
    const document = JSON.parse(files[name]);
    const validation = validateProducerResearchPackage(document);
    proposals += validation.exact_calibration_count;
    const json = JSON.stringify(document);
    const tag = `$gate4_doc_${index + 1}$`;
    if (json.includes(tag)) throw new Error(`${name}: unsafe SQL delimiter collision`);
    statements.push(`do ${tag} begin perform public.import_drinking_window_profile_exchange('${json.replaceAll("'", "''")}'::jsonb); end ${tag};`);
  }
  if (names.length !== 23 || proposals !== 670)
    throw new Error(`Expected the complete 23-file/670-row bundle, got ${names.length}/${proposals}`);
  return [
    '-- PRIVATE INPUT: owner research; run only on a disposable restored clone.',
    '-- Every import and identity/write check below rolls back.',
    'begin;',
    'set local standard_conforming_strings = on;',
    `select set_config('gate4.reference_before',
      (select count(*)::text from public.drinking_window_reference_rows), true);`,
    `select set_config('request.jwt.claim.sub',
      (select user_id::text from public.enrichment_curator_eligibilities
       where 'drinking-window' = any(profile_scopes)), true);`,
    'set local role authenticated;',
    ...statements,
    'reset role;',
    `do $gate4_check$ declare v_profiles integer; v_rows integer; begin
      select count(*), coalesce(sum(jsonb_array_length(document -> 'exact_release_calibrations')), 0)
        into v_profiles, v_rows from private.drinking_window_profile_exchanges;
      if v_profiles <> 23 or v_rows <> 670 then
        raise exception 'Expected 23 archived profiles and 670 proposals, got %/%',
          v_profiles, v_rows;
      end if;
      if (select count(*)::text from public.drinking_window_reference_rows)
         <> current_setting('gate4.reference_before') then
        raise exception 'An archive import unexpectedly changed reference rows';
      end if;
      raise notice 'Gate 4: all 23 profiles / 670 proposals imported privately; no advice rows changed; rolling back';
    end $gate4_check$;`,
    'rollback;',
    '',
  ].join('\n');
}

async function main(args) {
  if (args.length !== 2) throw new Error(
    'Usage: node gate4_import_rehearsal.mjs PRIVATE_PROFILE_DIR PRIVATE_OUTPUT.sql');
  const [directory, output] = args;
  const names = (await readdir(directory)).filter(name =>
    name.startsWith('CellarManager_') && name.endsWith('.json'));
  const files = Object.fromEntries(await Promise.all(names.map(async name =>
    [name, await readFile(resolve(directory, name), 'utf8')])));
  await writeFile(output, buildImportRehearsal(files), { mode: 0o600 });
  process.stdout.write('Prepared rollback-only import rehearsal for 23 private profiles.\n');
}
if (process.argv[1] && fileURLToPath(import.meta.url) === resolve(process.argv[1]))
  main(process.argv.slice(2)).catch(error => {
    process.stderr.write(`${error.message}\n`);
    process.exitCode = 1;
  });
