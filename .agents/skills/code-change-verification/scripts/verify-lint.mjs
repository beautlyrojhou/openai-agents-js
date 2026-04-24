#!/usr/bin/env node
/**
 * verify-lint.mjs
 *
 * Runs ESLint on a set of changed TypeScript/JavaScript files and reports
 * any lint errors or warnings. Designed to be called from the
 * code-change-verification skill pipeline.
 *
 * Usage:
 *   node verify-lint.mjs [--files <file1,file2,...>] [--root <project-root>]
 *                        [--max-warnings <n>] [--format <stylish|json>]
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, relative } from 'path';

function printUsage() {
  console.log(`
Usage: node verify-lint.mjs [options]

Options:
  --files <paths>        Comma-separated list of files to lint
  --root <dir>           Project root directory (default: cwd)
  --max-warnings <n>     Fail if lint warnings exceed this count (default: 0)
  --format <name>        ESLint output format: stylish | json (default: stylish)
  --help                 Show this help message
`);
}

function parseArgs(argv) {
  const args = {
    files: [],
    root: process.cwd(),
    maxWarnings: 0,
    format: 'stylish',
  };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === '--help') {
      printUsage();
      process.exit(0);
    } else if (arg === '--files' && argv[i + 1]) {
      args.files = argv[++i].split(',').map((f) => f.trim()).filter(Boolean);
    } else if (arg === '--root' && argv[i + 1]) {
      args.root = resolve(argv[++i]);
    } else if (arg === '--max-warnings' && argv[i + 1]) {
      args.maxWarnings = parseInt(argv[++i], 10);
    } else if (arg === '--format' && argv[i + 1]) {
      args.format = argv[++i];
    }
  }

  return args;
}

function resolveEslint(root) {
  // Prefer local project eslint binary
  const localBin = resolve(root, 'node_modules', '.bin', 'eslint');
  if (existsSync(localBin)) return localBin;

  // Fall back to globally available eslint
  try {
    execSync('eslint --version', { stdio: 'ignore' });
    return 'eslint';
  } catch {
    throw new Error(
      'ESLint not found. Install it via: npm install --save-dev eslint'
    );
  }
}

function filterLintableFiles(files, root) {
  return files
    .map((f) => resolve(root, f))
    .filter((f) => existsSync(f) && /\.[cm]?[jt]sx?$/.test(f));
}

function runLint(eslintBin, files, root, maxWarnings, format) {
  if (files.length === 0) {
    console.log('No lintable files provided — skipping lint check.');
    return { exitCode: 0, output: '' };
  }

  const relativeFiles = files.map((f) => relative(root, f));
  console.log(`\nLinting ${relativeFiles.length} file(s) in ${root}...`);

  const result = spawnSync(
    eslintBin,
    [
      '--no-eslintrc',
      '--config',
      existsSync(resolve(root, 'eslint.config.js'))
        ? resolve(root, 'eslint.config.js')
        : resolve(root, '.eslintrc.js'),
      `--max-warnings=${maxWarnings}`,
      `--format=${format}`,
      ...relativeFiles,
    ],
    { cwd: root, encoding: 'utf-8', stdio: 'pipe' }
  );

  const output = (result.stdout || '') + (result.stderr || '');
  return { exitCode: result.status ?? 1, output };
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  let eslintBin;
  try {
    eslintBin = resolveEslint(args.root);
  } catch (err) {
    console.error(`ERROR: ${err.message}`);
    process.exit(2);
  }

  const lintableFiles = filterLintableFiles(args.files, args.root);

  const { exitCode, output } = runLint(
    eslintBin,
    lintableFiles,
    args.root,
    args.maxWarnings,
    args.format
  );

  if (output.trim()) {
    console.log(output);
  }

  if (exitCode === 0) {
    console.log('✅ Lint check passed.');
  } else {
    console.error(`❌ Lint check failed (exit code ${exitCode}).`);
  }

  process.exit(exitCode);
}

main();
