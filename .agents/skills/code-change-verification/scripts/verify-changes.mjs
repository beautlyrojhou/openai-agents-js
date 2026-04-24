#!/usr/bin/env node
/**
 * verify-changes.mjs
 *
 * Verifies that code changes in a pull request or commit range meet
 * quality and consistency standards for the openai-agents-js project.
 *
 * Usage:
 *   node verify-changes.mjs [options]
 *
 * Options:
 *   --base <ref>       Base git ref to compare against (default: main)
 *   --head <ref>       Head git ref to compare (default: HEAD)
 *   --output <file>    Write JSON results to file
 *   --help             Show this help message
 */

import { execSync, spawnSync } from 'child_process';
import { writeFileSync } from 'fs';
import { resolve } from 'path';

function printUsage() {
  console.log(`
Usage: node verify-changes.mjs [options]

Options:
  --base <ref>       Base git ref to compare against (default: main)
  --head <ref>       Head git ref to compare (default: HEAD)
  --output <file>    Write JSON results to file
  --help             Show this help message
`);
}

function parseArgs(argv) {
  const args = { base: 'main', head: 'HEAD', output: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--base':   args.base   = argv[++i]; break;
      case '--head':   args.head   = argv[++i]; break;
      case '--output': args.output = argv[++i]; break;
      case '--help':   printUsage(); process.exit(0); break;
      default:
        console.error(`Unknown option: ${argv[i]}`);
        printUsage();
        process.exit(1);
    }
  }
  return args;
}

function run(cmd, { cwd } = {}) {
  const result = spawnSync('sh', ['-c', cmd], { encoding: 'utf8', cwd });
  if (result.status !== 0) {
    throw new Error(`Command failed: ${cmd}\n${result.stderr}`);
  }
  return result.stdout.trim();
}

function getChangedFiles(base, head) {
  const output = run(`git diff --name-status ${base}...${head}`);
  if (!output) return [];
  return output.split('\n').map((line) => {
    const [status, ...parts] = line.split('\t');
    return { status: status[0], path: parts[parts.length - 1] };
  });
}

function checkTypeScriptFiles(files) {
  const tsFiles = files.filter(
    (f) => f.status !== 'D' && (f.path.endsWith('.ts') || f.path.endsWith('.tsx'))
  );
  const issues = [];

  for (const file of tsFiles) {
    try {
      const content = run(`git show HEAD:${file.path}`);
      if (content.includes('any') && !content.includes('// eslint-disable')) {
        // Soft warning — explicit `any` usage without a disable comment
        issues.push({ file: file.path, level: 'warning', message: 'Contains unguarded `any` type usage' });
      }
      if (/console\.log\(/.test(content)) {
        issues.push({ file: file.path, level: 'warning', message: 'Contains console.log statement(s)' });
      }
    } catch {
      // File may not exist at HEAD yet; skip
    }
  }

  return issues;
}

function checkChangesetPresence(files) {
  const hasChangeset = files.some(
    (f) => f.status !== 'D' && f.path.startsWith('.changeset/') && f.path.endsWith('.md')
  );
  const hasSourceChanges = files.some(
    (f) => f.status !== 'D' && (f.path.startsWith('src/') || f.path.startsWith('packages/'))
  );

  if (hasSourceChanges && !hasChangeset) {
    return [{ level: 'error', message: 'Source changes detected but no changeset file found in .changeset/' }];
  }
  return [];
}

function main() {
  const args = parseArgs(process.argv.slice(2));

  console.log(`Verifying changes: ${args.base}...${args.head}`);

  let changedFiles;
  try {
    changedFiles = getChangedFiles(args.base, args.head);
  } catch (err) {
    console.error(`Failed to get changed files: ${err.message}`);
    process.exit(1);
  }

  console.log(`Changed files: ${changedFiles.length}`);

  const issues = [
    ...checkTypeScriptFiles(changedFiles),
    ...checkChangesetPresence(changedFiles),
  ];

  const errors   = issues.filter((i) => i.level === 'error');
  const warnings = issues.filter((i) => i.level === 'warning');

  const result = {
    base: args.base,
    head: args.head,
    changedFileCount: changedFiles.length,
    errors,
    warnings,
    passed: errors.length === 0,
  };

  if (args.output) {
    writeFileSync(resolve(args.output), JSON.stringify(result, null, 2));
    console.log(`Results written to ${args.output}`);
  }

  if (warnings.length > 0) {
    console.warn(`\nWarnings (${warnings.length}):`);
    warnings.forEach((w) => console.warn(`  [warn]  ${w.file ? w.file + ': ' : ''}${w.message}`));
  }

  if (errors.length > 0) {
    console.error(`\nErrors (${errors.length}):`);
    errors.forEach((e) => console.error(`  [error] ${e.file ? e.file + ': ' : ''}${e.message}`));
    process.exit(1);
  }

  console.log('\nVerification passed.');
}

main();
