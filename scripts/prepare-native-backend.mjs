#!/usr/bin/env node
// Package native server sources into an isolated Vercel project directory.
// Does not copy credentials, local recordings, or an existing .vercel link.
import { cpSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const destination = process.argv[2] && resolve(process.argv[2]);
if (!destination || destination === root || destination.startsWith(root + '/')) {
  throw new Error('Provide a separate deployment directory outside the source checkout.');
}
mkdirSync(destination, { recursive: true });
for (const name of ['src', 'public', 'package.json', 'package-lock.json', 'next.config.ts', 'tsconfig.json', 'postcss.config.mjs', 'eslint.config.mjs']) {
  if (existsSync(resolve(root, name))) cpSync(resolve(root, name), resolve(destination, name), { recursive: true });
}
writeFileSync(resolve(destination, '.vercelignore'), '.env*\n*.secret\ncredentials*\nnode_modules\n');
writeFileSync(resolve(destination, 'vercel.json'), JSON.stringify({ framework: 'nextjs', crons: [
  { path: '/api/native/v1/capture/sweep', schedule: '0 22 * * *' },
]}, null, 2) + '\n');
// Assert the isolation guard is included before allowing deployment.
if (!readFileSync(resolve(destination, 'src/proxy.ts'), 'utf8').includes('TRACE_NATIVE_API_ONLY')) {
  throw new Error('Native-only deployment guard is missing.');
}
console.log('Native backend prepared at ' + destination);
