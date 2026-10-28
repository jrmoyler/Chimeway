#!/usr/bin/env node
/**
 * Fails the build if a server secret reached the client bundle.
 *
 * Scans only what is actually served and executed - not sourcemaps, which
 * legitimately contain library documentation mentioning things like
 * `service_role` and would otherwise produce a false failure on every build.
 *
 * Matches on secret *shapes* rather than the words alone, for the same reason:
 * a variable name in a comment is not a leak, a JWT whose payload says
 * service_role is.
 */

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, extname } from 'node:path';

const DIST = 'dist';
const SCANNED_EXTENSIONS = new Set(['.js', '.mjs', '.cjs', '.html', '.css', '.json']);

/** Each rule describes a real credential, not a mention of one. */
const RULES = [
  {
    name: 'Supabase service_role JWT',
    // A JWT whose decoded payload names the service_role.
    test: (text) => {
      const jwts = text.match(/eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]{10,}/g) ?? [];
      return jwts.filter((jwt) => {
        try {
          const payload = JSON.parse(
            Buffer.from(jwt.split('.')[1], 'base64url').toString('utf8'),
          );
          return payload.role === 'service_role';
        } catch {
          return false;
        }
      });
    },
  },
  {
    name: 'Google API key',
    // Real keys are AIza + 35 characters. Matched loosely on purpose: an
    // exact length check misses a key that is one character off and reports
    // clean, which is the worst possible outcome for this kind of rule.
    test: (text) => text.match(/\bAIza[0-9A-Za-z_-]{30,}/g) ?? [],
  },
  {
    name: 'Assigned service-role env var',
    test: (text) => text.match(/SUPABASE_SERVICE_ROLE_KEY\s*[:=]\s*["'][^"']+["']/g) ?? [],
  },
  {
    name: 'Assigned Gemini key',
    test: (text) => text.match(/GEMINI_API_KEY\s*[:=]\s*["'][^"'\s]{8,}["']/g) ?? [],
  },
];

function walk(dir) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) out.push(...walk(full));
    else if (SCANNED_EXTENSIONS.has(extname(full))) out.push(full);
  }
  return out;
}

let failed = false;
let scanned = 0;

for (const file of walk(DIST)) {
  const text = readFileSync(file, 'utf8');
  scanned += 1;

  for (const rule of RULES) {
    const hits = rule.test(text);
    if (hits.length > 0) {
      failed = true;
      console.error(`SECRET LEAK  ${rule.name} in ${file}`);
      for (const hit of hits.slice(0, 2)) {
        console.error(`             ${String(hit).slice(0, 60)}...`);
      }
    }
  }
}

if (failed) {
  console.error('\nA server secret is present in the client bundle. Do not deploy this build.');
  process.exit(1);
}

console.log(`No server secrets found in ${scanned} served files.`);
