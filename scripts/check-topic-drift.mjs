#!/usr/bin/env node

/**
 * Topic Registry Drift Check (Issue #233)
 *
 * Validates that topic definitions stay synchronized across:
 * 1. client/src/App.jsx (modeMap)
 * 2. client/src/features/tiles.js (TILES and FEATURED_TILES)
 * 3. server/index.js (app.use('/<type>-api'))
 *
 * Any divergence must be explicitly documented in scripts/topic-drift-allowlist.json.
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const appJsxPath = path.join(rootDir, 'client', 'src', 'App.jsx');
const tilesJsPath = path.join(rootDir, 'client', 'src', 'features', 'tiles.js');
const serverJsPath = path.join(rootDir, 'server', 'index.js');
const allowlistPath = path.join(rootDir, 'scripts', 'topic-drift-allowlist.json');

// --- 1. Read and parse modeMap from client/src/App.jsx ---
if (!fs.existsSync(appJsxPath)) {
  console.error(`Error: Could not find ${appJsxPath}`);
  process.exit(1);
}
const appJsx = fs.readFileSync(appJsxPath, 'utf8');
const modeMapMatch = appJsx.match(/const\s+modeMap\s*=\s*\{([\s\S]*?)\n\s*\}/);
if (!modeMapMatch) {
  console.error('Error: Failed to locate modeMap declaration in client/src/App.jsx');
  process.exit(1);
}
const modeMapKeys = new Set();
for (const line of modeMapMatch[1].split('\n')) {
  const trimmed = line.trim();
  if (!trimmed || trimmed.startsWith('//')) continue;
  const keyMatch = trimmed.match(/^(['"]?)([a-zA-Z0-9_-]+)\1\s*:/);
  if (keyMatch) {
    modeMapKeys.add(keyMatch[2]);
  }
}

// --- 2. Read and parse tiles from client/src/features/tiles.js ---
if (!fs.existsSync(tilesJsPath)) {
  console.error(`Error: Could not find ${tilesJsPath}`);
  process.exit(1);
}
const tilesJs = fs.readFileSync(tilesJsPath, 'utf8');
const tileKeys = new Set();
for (const match of tilesJs.matchAll(/key:\s*['"]([a-zA-Z0-9_-]+)['"]/g)) {
  tileKeys.add(match[1]);
}

// --- 3. Read and parse server route prefixes from server/index.js ---
if (!fs.existsSync(serverJsPath)) {
  console.error(`Error: Could not find ${serverJsPath}`);
  process.exit(1);
}
const serverJs = fs.readFileSync(serverJsPath, 'utf8');
const serverRoutes = new Set();
for (const match of serverJs.matchAll(/app\.use\(['"]\/([a-zA-Z0-9_-]+)-api['"]/g)) {
  serverRoutes.add(match[1]);
}

// --- 4. Load allowlist ---
if (!fs.existsSync(allowlistPath)) {
  console.error(`Error: Could not find allowlist at ${allowlistPath}`);
  process.exit(1);
}
const allowlist = JSON.parse(fs.readFileSync(allowlistPath, 'utf8'));
const aliases = allowlist.aliases || {};
const clientOnlyWithTile = allowlist.clientOnlyWithTile || {};
const internalOrNavModes = allowlist.internalOrNavigationModes || {};
const routableWithoutTile = allowlist.routableWithoutTile || {};
const serverRoutesWithoutFrontend = allowlist.serverRoutesWithoutFrontend || {};

// Set of route keys accounted for via aliases
const aliasedRoutes = new Set(Object.values(aliases).map(a => a.route));

// --- 5. Evaluate Drift ---
const errors = [];
const inSyncTopics = [];
const allowlistedExceptions = [];

// Track used allowlist keys to detect obsolete entries
const usedAliases = new Set();
const usedClientOnly = new Set();
const usedInternalNav = new Set();
const usedRoutableWithoutTile = new Set();
const usedServerRoutesWithoutFrontend = new Set();

// Check all modeMap keys
for (const key of modeMapKeys) {
  const hasTile = tileKeys.has(key);
  const hasRoute = serverRoutes.has(key);

  if (hasTile && hasRoute) {
    inSyncTopics.push(key);
    continue;
  }

  // Check alias
  if (aliases[key]) {
    const targetRoute = aliases[key].route;
    if (serverRoutes.has(targetRoute)) {
      usedAliases.add(key);
      allowlistedExceptions.push({ key, reason: aliases[key].reason, category: 'alias' });
      continue;
    } else {
      errors.push(`Alias '${key}' targets route '${targetRoute}', but route '/${targetRoute}-api' does not exist in server/index.js`);
      continue;
    }
  }

  // Check clientOnlyWithTile
  if (clientOnlyWithTile[key]) {
    if (!hasTile) {
      errors.push(`'${key}' is allowlisted as clientOnlyWithTile, but is missing from client/src/features/tiles.js`);
    } else if (hasRoute) {
      errors.push(`'${key}' is allowlisted as clientOnlyWithTile, but route '/${key}-api' now exists in server/index.js (remove from allowlist)`);
    } else {
      usedClientOnly.add(key);
      allowlistedExceptions.push({ key, reason: clientOnlyWithTile[key], category: 'client-only with tile' });
    }
    continue;
  }

  // Check internalOrNavigationModes
  if (internalOrNavModes[key]) {
    if (hasTile) {
      errors.push(`'${key}' is allowlisted as internalOrNavigationModes, but now has a tile in client/src/features/tiles.js (remove from allowlist)`);
    } else if (hasRoute) {
      errors.push(`'${key}' is allowlisted as internalOrNavigationModes, but route '/${key}-api' now exists in server/index.js`);
    } else {
      usedInternalNav.add(key);
      allowlistedExceptions.push({ key, reason: internalOrNavModes[key], category: 'internal or navigation mode' });
    }
    continue;
  }

  // Check routableWithoutTile
  if (routableWithoutTile[key]) {
    if (hasTile) {
      errors.push(`'${key}' is allowlisted as routableWithoutTile, but now has a tile in client/src/features/tiles.js (remove from allowlist)`);
    } else if (!hasRoute) {
      errors.push(`'${key}' is allowlisted as routableWithoutTile, but route '/${key}-api' is missing from server/index.js`);
    } else {
      usedRoutableWithoutTile.add(key);
      allowlistedExceptions.push({ key, reason: routableWithoutTile[key], category: 'routable without tile' });
    }
    continue;
  }

  // If we reach here, key has unexplained drift
  errors.push(`Unexplained drift in modeMap key '${key}': tile: ${hasTile ? 'YES' : 'NO'}, server-route: ${hasRoute ? 'YES' : 'NO'}`);
}

// Check tile keys that were not in modeMap
for (const key of tileKeys) {
  if (!modeMapKeys.has(key)) {
    errors.push(`Tile key '${key}' exists in client/src/features/tiles.js but has no matching entry in client/src/App.jsx modeMap`);
  }
}

// Check server routes that were not in modeMap
for (const key of serverRoutes) {
  if (modeMapKeys.has(key) || aliasedRoutes.has(key)) {
    continue;
  }

  if (serverRoutesWithoutFrontend[key]) {
    usedServerRoutesWithoutFrontend.add(key);
    allowlistedExceptions.push({ key, reason: serverRoutesWithoutFrontend[key], category: 'server-only route' });
    continue;
  }

  errors.push(`Server route '/${key}-api' in server/index.js is not mapped in client/src/App.jsx modeMap or scripts/topic-drift-allowlist.json`);
}

// Check for stale allowlist entries
for (const key of Object.keys(aliases)) {
  if (!usedAliases.has(key)) {
    errors.push(`Stale allowlist entry in aliases: '${key}'`);
  }
}
for (const key of Object.keys(clientOnlyWithTile)) {
  if (!usedClientOnly.has(key)) {
    errors.push(`Stale allowlist entry in clientOnlyWithTile: '${key}'`);
  }
}
for (const key of Object.keys(internalOrNavModes)) {
  if (!usedInternalNav.has(key)) {
    errors.push(`Stale allowlist entry in internalOrNavigationModes: '${key}'`);
  }
}
for (const key of Object.keys(routableWithoutTile)) {
  if (!usedRoutableWithoutTile.has(key)) {
    errors.push(`Stale allowlist entry in routableWithoutTile: '${key}'`);
  }
}
for (const key of Object.keys(serverRoutesWithoutFrontend)) {
  if (!usedServerRoutesWithoutFrontend.has(key)) {
    errors.push(`Stale allowlist entry in serverRoutesWithoutFrontend: '${key}'`);
  }
}

// --- 6. Output Results ---
console.log('='.repeat(70));
console.log(' TENALI TOPIC REGISTRY DRIFT CHECK');
console.log('='.repeat(70));
console.log(`• modeMap entries:      ${modeMapKeys.size}`);
console.log(`• Tile entries:         ${tileKeys.size}`);
console.log(`• Server routes:        ${serverRoutes.size}`);
console.log(`• In-sync topics:       ${inSyncTopics.length}`);
console.log(`• Allowlisted items:    ${allowlistedExceptions.length}`);
console.log('='.repeat(70));

if (errors.length > 0) {
  console.error('\n❌ Topic drift check FAILED! The following discrepancies were found:\n');
  for (const err of errors) {
    console.error(`  - ${err}`);
  }
  console.error('\nFix the inconsistency in code or document intentional exceptions in scripts/topic-drift-allowlist.json.\n');
  process.exit(1);
}

console.log(`\n✅ Topic drift check PASSED! All ${inSyncTopics.length + allowlistedExceptions.length} topics accounted for.`);
process.exit(0);
