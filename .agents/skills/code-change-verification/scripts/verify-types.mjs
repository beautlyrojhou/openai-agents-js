#!/usr/bin/env node
/**
 * verify-types.mjs
 *
 * Runs TypeScript type-checking on changed files and reports any type errors.
 * Used by the code-change-verification skill to ensure type safety after
 * modifications are applied.
 *
 * Usage:
 *   node verify-types.mjs [--files <file1,file2,...>] [--tsconfig <path>]
 *   node verify-types.mjs --help
 */

import { execSync, spawnSync } from 'child_process';
import { existsSync, readFileSync } from 'fs';
import { resolve, dirname, relative } from 'path';

function printUsage() {
  console.log(`
Usage: node verify-types.mjs [options]

Options:
  --files <list>      Comma-separated list of files to check (optional)
  --tsconfig <path>   Path to tsconfig.json (default: tsconfig.json)
  --project-root <p>  Root directory of the project (default: cwd)
  --help              Show this help message

Exits with code 0 on success, 1 on type errors, 2 on configuration errors.
`);
}

function parseArgs(argv) {
  const args = { files: [], tsconfig: 'tsconfig.json', projectRoot: process.cwd() };
  for (let i = 2; i < argv.length; i++) {
    if (argv[i] === '--help') { printUsage(); process.exit(0); }
    if (argv[i] === '--files' && argv[i + 1]) {
      args.files = argv[++i].split(',').map(f => f.trim()).filter(Boolean);
    } else if (argv[i] === '--tsconfig' && argv[i + 1]) {
      args.tsconfig = argv[++i];
    } else if (argv[i] === '--project-root' && argv[i + 1]) {
      args.projectRoot = resolve(argv[++i]);
    }
  }
  return args;
}

function findTsConfig(projectRoot, tsconfigPath) {
  const candidates = [
    resolve(projectRoot, tsconfigPath),
    resolve(projectRoot, 'tsconfig.json'),
    resolve(projectRoot, 'tsconfig.base.json'),
  ];
  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

function resolveTsc(projectRoot) {
  const local = resolve(projectRoot, 'node_modules', '.bin', 'tsc');
  if (existsSync(local)) return local;
  // Fall back to globally available tsc
  try {
    execSync('tsc --version', { stdio: 'ignore' });
    return 'tsc';
  } catch {
    return null;
  }
}

function runTypeCheck(tsc, tsconfig, files) {
  const args = ['--noEmit', '--pretty', '--project', tsconfig];

  // When specific files are provided we override the tsconfig include list.
  // Note: passing files disables tsconfig "files"/"include" so we add
  // --skipLibCheck to avoid pulling in unrelated declaration errors.
  if (files.length > 0) {
    args.push('--skipLibCheck', ...files);
  }

  const result = spawnSync(tsc, args, { encoding: 'utf8', shell: process.platform === 'win32' });
  return {
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    exitCode: result.status ?? 1,
  };
}

function formatOutput(stdout, stderr) {
  const lines = (stdout + '\n' + stderr).trim().split('\n').filter(Boolean);
  return lines.join('\n');
}

function main() {
  const args = parseArgs(process.argv);

  const tsconfigPath = findTsConfig(args.projectRoot, args.tsconfig);
  if (!tsconfigPath) {
    console.error(`[verify-types] ERROR: Could not find tsconfig at '${args.tsconfig}' under '${args.projectRoot}'`);
    process.exit(2);
  }

  const tsc = resolveTsc(args.projectRoot);
  if (!tsc) {
    console.error('[verify-types] ERROR: TypeScript compiler (tsc) not found. Install it with: npm install typescript');
    process.exit(2);
  }

  const relativeFiles = args.files.map(f => relative(args.projectRoot, resolve(f)));
  const fileLabel = relativeFiles.length > 0 ? relativeFiles.join(', ') : '(all project files)';

  console.log(`[verify-types] Running type check`);
  console.log(`[verify-types]   tsconfig : ${relative(args.projectRoot, tsconfigPath)}`);
  console.log(`[verify-types]   files    : ${fileLabel}`);

  const { stdout, stderr, exitCode } = runTypeCheck(tsc, tsconfigPath, relativeFiles);
  const output = formatOutput(stdout, stderr);

  if (exitCode === 0) {
    console.log('[verify-types] ✅ No type errors found.');
    process.exit(0);
  } else {
    console.error('[verify-types] ❌ Type errors detected:\n');
    console.error(output);
    process.exit(1);
  }
}

main();
