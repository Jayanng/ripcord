#!/usr/bin/env node
/**
 * check-silent-failures.mjs - mechanical scan for verification code that can
 * fail silently. This is layer 8 of the honest-test-gates discipline: these
 * patterns must be blocked by a scanner, not by anyone's memory.
 *
 * Scanned: packages/core/test/**\/*.test.ts, packages/core/test/live-fixtures.ts,
 *          scripts/**\/*.mjs
 *
 * HARD violations (exit 1):
 *   1. Unpinned rejection assertion: .rejects.toThrow() / .rejects.toThrowError()
 *      with no argument - passes for ANY error, including the wrong guard.
 *   2. Vacuous filler assertion: expect(...).toBeTypeOf(...) - cannot fail on
 *      anything the code under test does.
 *   3. Empty catch block: catch {} / catch (e) {} with an empty body - swallows
 *      errors whole.
 *   4. Swallowed rejection: .catch(() => ...) with an empty/constant body in
 *      verification code.
 *
 * SOFT warnings (listed, exit 0):
 *   5. console.* immediately followed by a bare `return;` without ctx.skip() -
 *      the fake-pass signature (a skip must be reported as a skip).
 *   6. it() blocks containing neither expect( nor ctx.skip( - a test that
 *      asserts nothing and skips nothing.
 *
 * Sabotage-tested: every hard class above was planted in a temp file, this
 * scanner went red on all of them, and green again once removed. If you add a
 * pattern here, plant it first and watch this fail before trusting it.
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

const ROOT = process.cwd();
const targets = [];
function walk(dir) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) walk(p);
    else if (/(\.test\.ts|live-fixtures\.ts)$/.test(name) || (/\.mjs$/.test(name) && p.includes('scripts'))) targets.push(p);
  }
}
for (const dir of ['packages/core/test', 'scripts']) {
  try { walk(join(ROOT, dir)); } catch { /* dir may not exist in other repos */ }
}

const hard = [];
const soft = [];

for (const file of targets) {
  const rel = relative(ROOT, file);
  // The scanner's own patterns live in its doc and regexes - it cannot scan itself.
  if (rel.endsWith('check-silent-failures.mjs')) continue;
  const src = readFileSync(file, 'utf8');
  const lines = src.split('\n');
  // Track block comments: pattern text inside /* ... */ is documentation,
  // not code (health.test documents a FIXED bare catch in its audit notes).
  let inBlockComment = false;

  lines.forEach((line, i) => {
    const at = `${rel}:${i + 1}`;
    if (inBlockComment) {
      if (/\*\//.test(line)) inBlockComment = false;
      return;
    }
    if (/\/\*/.test(line) && !/\*\//.test(line)) { inBlockComment = true; return; }
    const code = line.split('//')[0];
    // Intentional best-effort handling must be tagged: `// silent-ok: <reason>`.
    const suppressed = /silent-ok:\s*\S/.test(line);

    // 1. unpinned rejection assertions
    if (!suppressed && /\.rejects\.toThrow(Error)?\(\s*\)/.test(code)) {
      hard.push(`${at}  UNPINNED .rejects.toThrow() - passes for any error; pin the class/message`);
    }

    // 2. vacuous filler
    if (!suppressed && /\.toBeTypeOf\(/.test(code)) {
      hard.push(`${at}  VACUOUS expect().toBeTypeOf() - asserts nothing about the code under test`);
    }

    // 3. empty catch block (same line or brace-empty)
    if (!suppressed && /catch\s*(\([^)]*\))?\s*\{\s*\}/.test(code)) {
      hard.push(`${at}  EMPTY catch block - swallows errors whole`);
    }

    // 4. swallowed rejection with a constant/empty body
    if (!suppressed && /\.catch\(\s*(\([^)]*\)|[A-Za-z_$][\w$]*)\s*=>\s*(null|undefined|\{\}|''|0)?\s*\)/.test(code)) {
      hard.push(`${at}  SWALLOWED .catch(() => constant) - hides failures in verification code`);
    }

    // 5. console + bare return without ctx.skip (fake-pass signature)
    if (/^\s*(console\.(log|warn)|return;)/.test(code)) {
      const window = lines.slice(Math.max(0, i - 2), i + 3).join('\n');
      if (/console\.(log|warn)\(/.test(window) && /^\s*return;\s*$/m.test(window)
        && !/ctx\.skip\(|expect\(|fixtureSkipReason/.test(window) && !suppressed) {
        soft.push(`${at}  console + bare 'return;' without ctx.skip() - check this is not a fake pass`);
      }
    }
  });

  // 6. it() blocks with no assertion and no skip
  const chunks = src.split(/\n\s{0,8}it(?:\.skipIf\([\s\S]*?\))?\(/).slice(1);
  chunks.forEach((chunk, idx) => {
    const body = chunk;
    if (!/expect\(/.test(body) && !/ctx\.skip\(/.test(body)) {
      const nameMatch = chunk.match(/^\s*'([^']{0,60})/);
      soft.push(`${rel}  it-block #${idx + 1} ('${nameMatch ? nameMatch[1] : '?'}') has no expect() and no ctx.skip()`);
    }
  });
}

for (const v of hard) console.log(`HARD  ${v}`);
for (const v of soft) console.log(`soft  ${v}`);
console.log(`\ncheck-silent-failures: scanned ${targets.length} files - ${hard.length} hard violations, ${soft.length} soft warnings`);
process.exit(hard.length > 0 ? 1 : 0);
