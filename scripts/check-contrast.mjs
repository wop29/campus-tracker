// Verifies WCAG contrast for every theme declared in app/globals.css. Exit code 1 on any failure.
// Usage: node scripts/check-contrast.mjs
import { readFileSync } from 'node:fs';

const css = readFileSync(new URL('../app/globals.css', import.meta.url), 'utf8');
const parseVars = (body) => Object.fromEntries([...body.matchAll(/--color-([a-z-]+):\s*(#[0-9a-fA-F]{6})/g)].map((m) => [m[1], m[2].toUpperCase()]));
const themes = {};
for (const m of css.matchAll(/\[data-theme="([a-z]+)"\]\s*\{([^}]*)\}/g)) themes[m[1]] = parseVars(m[2]);
const base = parseVars(css.match(/@theme static\s*\{([^}]*)\}/)[1]);

const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const lin = (c) => { const s = c / 255; return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4; };
const lum = (h) => { const [r, g, b] = rgb(h).map(lin); return 0.2126 * r + 0.7152 * g + 0.0722 * b; };
const ratio = (a, b) => { const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p); return (x + 0.05) / (y + 0.05); };
const mix = (fg, bg, a) => '#' + rgb(fg).map((c, i) => Math.round(c * a + rgb(bg)[i] * (1 - a)).toString(16).padStart(2, '0')).join('').toUpperCase();

let failures = 0;
const rows = [];
function check(theme, name, fg, bg, min) {
  const r = ratio(fg, bg);
  const ok = r >= min;
  if (!ok) failures++;
  rows.push({ theme, check: name, fg, bg, ratio: r.toFixed(2), min, result: ok ? 'pass' : 'FAIL' });
}

if (!themes.sunny) { console.error('sunny theme missing'); process.exit(1); }
for (const k of new Set([...Object.keys(base), ...Object.keys(themes.sunny)])) {
  if (base[k] !== themes.sunny[k]) { failures++; console.error(`@theme default and [data-theme="sunny"] differ for --color-${k}`); }
}
const required = ['primary', 'secondary', 'bg', 'surface', 'border', 'line', 'success', 'warning', 'danger', 'accent', 'ink', 'success-ink', 'warning-ink', 'danger-ink', 'accent-ink', 'on-fun',
  ...['green', 'blue', 'orange', 'pink', 'yellow', 'purple'].flatMap((c) => [`fun-${c}`, `fun-${c}-dark`])];
const WHITE = '#FFFFFF';
for (const [name, t] of Object.entries(themes)) {
  for (const k of required) if (!t[k]) { failures++; console.error(`${name}: missing --color-${k}`); }
  check(name, 'body text (ink) on bg', t.ink, t.bg, 4.5);
  check(name, 'body text (ink) on surface', t.ink, t.surface, 4.5);
  check(name, 'muted text (secondary) on bg', t.secondary, t.bg, 4.5);
  check(name, 'muted text (secondary) on surface', t.secondary, t.surface, 4.5);
  check(name, 'link/accent on surface', t['accent-ink'], t.surface, 4.5);
  check(name, 'link/accent on bg', t['accent-ink'], t.bg, 4.5);
  for (const s of ['success', 'warning', 'danger', 'accent']) {
    check(name, `${s} text on surface`, t[`${s}-ink`], t.surface, 4.5);
    check(name, `${s} text on bg`, t[`${s}-ink`], t.bg, 4.5);
    check(name, `${s} text on 15% ${s} tint (badge)`, t[`${s}-ink`], mix(t[s], t.surface, 0.15), 4.5);
  }
  for (const s of ['primary', 'success', 'danger']) check(name, `white label on ${s} fill`, WHITE, t[s], 4.5);
  check(name, 'form control border (line) on surface', t.line, t.surface, 3);
  check(name, 'focus ring on bg', t['accent-ink'], t.bg, 3);
  check(name, 'focus ring on surface', t['accent-ink'], t.surface, 3);
  for (const c of ['green', 'blue', 'orange', 'pink', 'yellow', 'purple']) {
    check(name, `button label on fun-${c}`, t['on-fun'], t[`fun-${c}`], 4.5);
    check(name, `ink on fun-${c} 20% tint (nav pill)`, t.ink, mix(t[`fun-${c}`], t.surface, 0.2), 4.5);
    check(name, `fun-${c}-dark edge vs surface (graphic)`, t[`fun-${c}-dark`], t.surface, 1.5);
  }
}
const w = (s, n) => String(s).padEnd(n);
console.log(w('theme', 10) + w('check', 44) + w('fg', 9) + w('bg', 9) + w('ratio', 7) + w('min', 5) + 'result');
for (const r of rows) console.log(w(r.theme, 10) + w(r.check, 44) + w(r.fg, 9) + w(r.bg, 9) + w(r.ratio, 7) + w(r.min, 5) + r.result);
const worst = {};
for (const r of rows) if (!worst[r.theme] || r.ratio / r.min < worst[r.theme].ratio / worst[r.theme].min) worst[r.theme] = r;
console.log('\nTightest check per theme:');
for (const [t, r] of Object.entries(worst)) console.log(`  ${t}: ${r.check} = ${r.ratio} (min ${r.min})`);
console.log(`\n${rows.length} checks across ${Object.keys(themes).length} themes, ${failures} failure(s).`);
process.exit(failures ? 1 : 0);
