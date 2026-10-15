import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  parseOptions, stageCandidates, validateCandidates,
} from './stage_workbook_candidates.mjs';

const hash = 'a'.repeat(64);
const row = () => ({
  source_sha256: hash,
  source_locator: 'Millesimes!L3:M3',
  candidate_scope: 'region',
  source_identity: {
    region: 'Synthetic region', color: 'blanc', historical_bin: 'standard',
    source_cells: {
      region: 'Millesimes!A3', color: 'Millesimes!C3',
      vintage: 'Millesimes!D3', best_start_offset: 'Millesimes!L3',
      best_end_offset: 'Millesimes!M3',
    },
  },
  wine_color: 'white', vintage_year: 2022, first_trial_year: null,
  best_start_year: 2025, best_end_year: 2030, review_status: 'staged',
});

test('dry-run is the default and apply must be explicit', () => {
  assert.equal(parseOptions(['--candidates', '/private/file.json', '--expected-sha256', hash]).apply, false);
  assert.equal(parseOptions(['--candidates', '/private/file.json', '--expected-sha256', hash, '--apply']).apply, true);
});

test('a valid pair remains an incomplete, service-private candidate', () => {
  assert.deepEqual(validateCandidates([row()], hash), {
    total: 1, staged: 1, quarantined: 0, source_sha256: hash,
  });
});

test('rejects household fields, Cave coordinates, duplicate locators, and invented first year', () => {
  assert.throws(() => validateCandidates([{ ...row(), bottle_count: 2 }], hash));
  assert.throws(() => validateCandidates([{ ...row(), source_locator: 'Cave!L3:M3' }], hash));
  assert.throws(() => validateCandidates([row(), row()], hash));
  assert.throws(() => validateCandidates([{ ...row(), first_trial_year: 2024 }], hash));
  assert.throws(() => validateCandidates([{ ...row(), source_identity: {
    ...row().source_identity, source_cells: { note: 'Cave!M3' },
  } }], hash));
});

test('quarantine reason is retained while unknown reasons are rejected', () => {
  const quarantined = {
    ...row(), candidate_scope: 'quarantine', review_status: 'needs-review',
    best_start_year: null, best_end_year: null, review_reason: 'incomplete_pair',
  };
  assert.equal(validateCandidates([quarantined], hash).quarantined, 1);
  assert.throws(() => validateCandidates([{ ...quarantined, review_reason: 'guess' }], hash));
});

test('apply uses one atomic RPC request and reports counts only', async () => {
  const calls = [];
  const result = await stageCandidates([row()], {
    supabaseUrl: 'https://example.supabase.co', secretKey: 'sb_secret_test',
    fetchImpl: async (url, options) => {
      calls.push({ url: String(url), options });
      return { ok: true, json: async () => [{ inserted_count: 1, unchanged_count: 0 }] };
    },
  });
  assert.deepEqual(result, { inserted_count: 1, unchanged_count: 0 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'https://example.supabase.co/rest/v1/rpc/drinking_window_stage_workbook_candidates');
  assert.equal(JSON.parse(calls[0].options.body).p_rows.length, 1);
  assert.equal(calls[0].options.headers.apikey, 'sb_secret_test');
  assert.equal(calls[0].options.headers.authorization, undefined);
});

test('apply rejects non-local HTTP and never echoes a failed response body', async () => {
  await assert.rejects(stageCandidates([row()], {
    supabaseUrl: 'http://example.supabase.co', serviceRoleKey: 'test-key',
  }), /HTTPS/);
  await assert.rejects(stageCandidates([row()], {
    supabaseUrl: 'https://example.supabase.co', serviceRoleKey: 'test-key',
    fetchImpl: async () => ({ ok: false, status: 409, text: async () => 'private data' }),
  }), (error) => !error.message.includes('private data') && /HTTP 409/.test(error.message));
});
