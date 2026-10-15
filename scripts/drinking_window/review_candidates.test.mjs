import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const repoRoot = resolve(fileURLToPath(new URL('../../', import.meta.url)));
const script = join(repoRoot, 'scripts/drinking_window/review_candidates.mjs');

test('workbook review inputs must be private and outside the repository', () => {
  const privateDir = mkdtempSync(join(tmpdir(), 'cellarmanager-review-cli-'));
  try {
    const candidatesPath = join(privateDir, 'candidates.json');
    const snapshotPath = join(privateDir, 'snapshot.json');
    const confirmationsPath = join(privateDir, 'confirmations.json');
    const outputDir = join(privateDir, 'results');
    writeFileSync(candidatesPath, '[]');
    writeFileSync(snapshotPath, JSON.stringify({ producers: [], products: [], releases: [],
      places: [], place_aliases: [], wine_aliases: [] }));
    writeFileSync(confirmationsPath, JSON.stringify({ source_sha256: 'a'.repeat(64), mappings: [] }),
      { mode: 0o600 });
    mkdirSync(outputDir, { mode: 0o700 });
    const baseArgs = [script, '--candidates', candidatesPath, '--identity-snapshot', snapshotPath,
      '--out-dir', outputDir];
    for (const [option, label] of [
      ['--producer-research', 'Producer research'],
      ['--producer-confirmations', 'Owner confirmations'],
      ['--source-interpretations', 'Source interpretations'],
    ]) {
      const inRepo = spawnSync(process.execPath, [...baseArgs, option, join(repoRoot, 'package.json')],
        { cwd: repoRoot, encoding: 'utf8' });
      assert.equal(inRepo.status, 1);
      assert.match(inRepo.stderr, new RegExp(`${label} must be kept outside the repository`));
    }
    assert.equal(existsSync(join(outputDir, 'identity_review.json')), false);

    const privateInput = spawnSync(process.execPath,
      [...baseArgs, '--producer-confirmations', confirmationsPath],
      { cwd: repoRoot, encoding: 'utf8' });
    assert.equal(privateInput.status, 0, privateInput.stderr);
    assert.equal(existsSync(join(outputDir, 'identity_review.json')), true);
  } finally {
    rmSync(privateDir, { recursive: true, force: true });
  }
});
