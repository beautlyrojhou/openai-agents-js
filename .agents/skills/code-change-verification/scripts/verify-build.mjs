#!/usr/bin/env node
/**
 * verify-build.mjs
 *
 * Verifies that the project builds successfully after code changes.
 * Supports monorepo workspaces and single-package repositories.
 *
 * Usage:
 *   node verify-build.mjs [options]
 *
 * Options:
 *   --root <path>       Root directory of the repository (default: cwd)
 *   --changed <files>   Comma-separated list of changed files
 *   --workspace <name>  Specific workspace package to build (optional)
 *   --help              Show this help message
 */

import { execSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { resolve, dirname, join } from 'node:path';

function printUsage() {
  console.log(`
Usage: node verify-build.mjs [options]

Options:
  --root <path>       Root directory of the repository (default: cwd)
  --changed <files>   Comma-separated list of changed files
  --workspace <name>  Specific workspace package to build (optional)
  --help              Show this help message
`);
}

function parseArgs(argv) {
  const args = { root: process.cwd(), changed: [], workspace: null };
  for (let i = 0; i < argv.length; i++) {
    switch (argv[i]) {
      case '--help':
        printUsage();
        process.exit(0);
        break;
      case '--root':
        args.root = resolve(argv[++i]);
        break;
      case '--changed':
        args.changed = argv[++i].split(',').map((f) => f.trim()).filter(Boolean);
        break;
      case '--workspace':
        args.workspace = argv[++i];
        break;
      default:
        console.warn(`Unknown argument: ${argv[i]}`);
    }
  }
  return args;
}

function readJson(filePath) {
  try {
    return JSON.parse(readFileSync(filePath, 'utf8'));
  } catch {
    return null;
  }
}

function detectPackageManager(root) {
  if (existsSync(join(root, 'pnpm-lock.yaml'))) return 'pnpm';
  if (existsSync(join(root, 'yarn.lock'))) return 'yarn';
  return 'npm';
}

function getWorkspacePackages(root) {
  const pkg = readJson(join(root, 'package.json'));
  if (!pkg) return [];

  const workspaceGlobs = pkg.workspaces || [];
  if (workspaceGlobs.length === 0) return [];

  try {
    const result = spawnSync(
      'pnpm',
      ['list', '--recursive', '--json', '--depth', '0'],
      { cwd: root, encoding: 'utf8' }
    );
    if (result.status === 0) {
      const packages = JSON.parse(result.stdout);
      return packages.map((p) => ({ name: p.name, path: p.path }));
    }
  } catch {
    // fall through
  }
  return [];
}

function runBuild(cwd, packageManager, workspace) {
  const cmd = workspace
    ? `${packageManager} --filter ${workspace} run build`
    : `${packageManager} run build`;

  console.log(`Running: ${cmd}`);
  const result = spawnSync(cmd, {
    cwd,
    shell: true,
    encoding: 'utf8',
    stdio: 'pipe',
  });

  return {
    success: result.status === 0,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
    cmd,
  };
}

function hasBuildScript(root, workspace) {
  const pkgPath = workspace
    ? join(root, 'packages', workspace, 'package.json')
    : join(root, 'package.json');
  const pkg = readJson(pkgPath);
  return !!(pkg && pkg.scripts && pkg.scripts.build);
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const { root, changed, workspace } = args;
  const packageManager = detectPackageManager(root);

  console.log(`\n=== Build Verification ===`);
  console.log(`Root:            ${root}`);
  console.log(`Package manager: ${packageManager}`);
  if (workspace) console.log(`Workspace:       ${workspace}`);
  if (changed.length > 0) console.log(`Changed files:   ${changed.length}`);

  if (!hasBuildScript(root, workspace)) {
    console.log('\nNo build script found — skipping build verification.');
    process.exit(0);
  }

  const result = runBuild(root, packageManager, workspace);

  if (result.stdout) console.log('\nSTDOUT:\n' + result.stdout.trim());
  if (result.stderr) console.error('\nSTDERR:\n' + result.stderr.trim());

  if (result.success) {
    console.log('\n✅ Build succeeded.');
    process.exit(0);
  } else {
    console.error('\n❌ Build failed.');
    process.exit(1);
  }
}

main().catch((err) => {
  console.error('Unexpected error:', err);
  process.exit(1);
});
