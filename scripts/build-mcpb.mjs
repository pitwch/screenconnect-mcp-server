#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { copyFileSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'));
const version = pkg.version;

const stagingDir = join(root, '.mcpb-staging');
const serverDir = join(stagingDir, 'server');
const outFile = join(root, `screenconnect-mcp-server-v${version}.mcpb`);

rmSync(stagingDir, { recursive: true, force: true });
mkdirSync(serverDir, { recursive: true });

// Bundle src/index.ts into a single self-contained CommonJS Node 20 entrypoint.
await build({
  entryPoints: [join(root, 'src', 'index.ts')],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'cjs',
  outfile: join(serverDir, 'index.cjs'),
  sourcemap: false,
  minify: false,
  legalComments: 'none',
});

// Stage manifest.json synced with package.json version.
const manifest = JSON.parse(readFileSync(join(root, 'mcpb', 'manifest.json'), 'utf8'));
manifest.version = version;
const stagedManifestPath = join(stagingDir, 'manifest.json');
writeFileSync(stagedManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

// Copy icon and license into the bundle root.
copyFileSync(join(root, 'docs', 'assets', 'icon.png'), join(stagingDir, 'icon.png'));
copyFileSync(join(root, 'LICENSE'), join(stagingDir, 'LICENSE'));

const mcpbBin = join(
  root,
  'node_modules',
  '.bin',
  process.platform === 'win32' ? 'mcpb.cmd' : 'mcpb',
);

execFileSync(mcpbBin, ['validate', stagedManifestPath], { stdio: 'inherit' });
rmSync(outFile, { force: true });
execFileSync(mcpbBin, ['pack', stagingDir, outFile], { stdio: 'inherit' });

console.error(`Built MCPB bundle: ${outFile}`);
