#!/usr/bin/env node
/**
 * verify-tests.mjs
 *
 * Runs tests for files changed in a given commit range or branch diff.
 * Attempts to find and execute related test files for any TypeScript source
 * files that were modified, then reports pass/fail results in a structured
 * JSON format compatible with the code-change-verification skill.
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync } from 'fs';
import { resolve, dirname, basename, join } from 'path';

function printUsage() {
  console.error(`
Usage: verify-tests.mjs [options]

Options:
  --files <file1,file2,...>   Comma-separated list of changed files to check
  --base <ref>               Base git ref for diff (default: HEAD~1)
  --head <ref>               Head git ref for diff (default: HEAD)
  --root <dir>               Project root directory (default: cwd)
  --json                     Output results as JSON
  --help                     Show this help message
`);
}

function parseArgs(argv) {
  const args = { files: [], base: 'HEAD~1', head: 'HEAD', root: process.cwd(), json: false };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--files':  args.files = argv[++i]?.split(',').filter(Boolean) ?? []; break;
      case '--base':   args.base  = argv[++i]; break;
      case '--head':   args.head  = argv[++i]; break;
      case '--root':   args.root  = resolve(argv[++i]); break;
      case '--json':   args.json  = true; break;
      case '--help':   printUsage(); process.exit(0); break;
    }
  }
  return args;
}

function getChangedFiles(base, head, root) {
  try {
    const out = execSync(`git diff --name-only ${base} ${head}`, { cwd: root, encoding: 'utf8' });
    return out.split('\n').map(f => f.trim()).filter(Boolean);
  } catch {
    return [];
  }
}

/**
 * Given a source file path, return candidate test file paths to check.
 * Supports __tests__ sibling directories and *.test.ts / *.spec.ts conventions.
 */
function findTestCandidates(filePath, root) {
  const dir  = dirname(filePath);
  const base = basename(filePath).replace(/\.tsx?$/, '');
  return [
    join(dir, `${base}.test.ts`),
    join(dir, `${base}.spec.ts`),
    join(dir, '__tests__', `${base}.test.ts`),
    join(dir, '__tests__', `${base}.spec.ts`),
    join(dir, `${base}.test.tsx`),
    join(dir, `${base}.spec.tsx`),
  ].map(p => join(root, p)).filter(existsSync);
}

function runTests(testFiles, root) {
  if (testFiles.length === 0) {
    return { skipped: true, passed: 0, failed: 0, output: '' };
  }

  // Prefer vitest if available, fall back to jest
  const vitestBin = join(root, 'node_modules', '.bin', 'vitest');
  const jestBin   = join(root, 'node_modules', '.bin', 'jest');
  const runner    = existsSync(vitestBin) ? vitestBin : existsSync(jestBin) ? jestBin : null;

  if (!runner) {
    return { skipped: true, passed: 0, failed: 0, output: 'No test runner found (vitest or jest).' };
  }

  const runnerName = basename(runner);
  const extraArgs  = runnerName === 'vitest' ? ['run'] : [];
  const result = spawnSync(
    runner,
    [...extraArgs, ...testFiles],
    { cwd: root, encoding: 'utf8', env: { ...process.env, CI: '1' } }
  );

  const output = (result.stdout ?? '') + (result.stderr ?? '');
  const passed = result.status === 0;
  return {
    skipped: false,
    passed: passed ? testFiles.length : 0,
    failed: passed ? 0 : testFiles.length,
    output,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const changedFiles = args.files.length > 0
    ? args.files
    : getChangedFiles(args.base, args.head, args.root);

  const tsFiles = changedFiles.filter(f => /\.tsx?$/.test(f) && !/\.d\.ts$/.test(f));
  const testFiles = [...new Set(tsFiles.flatMap(f => findTestCandidates(f, args.root)))];

  const result = runTests(testFiles, args.root);

  const report = {
    tool:         'verify-tests',
    changedFiles: tsFiles,
    testFiles,
    skipped:      result.skipped,
    passed:       result.passed,
    failed:       result.failed,
    success:      result.failed === 0,
    output:       result.output,
  };

  if (args.json) {
    console.log(JSON.stringify(report, null, 2));
  } else {
    if (result.skipped) {
      console.log('⚠️  No test files found — skipping test verification.');
    } else if (result.failed > 0) {
      console.error(`❌ Tests failed for ${result.failed} file(s).`);
      if (result.output) console.error(result.output);
    } else {
      console.log(`✅ All ${result.passed} test file(s) passed.`);
    }
  }

  process.exit(result.failed > 0 ? 1 : 0);
}

main();
