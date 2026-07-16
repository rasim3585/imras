// i18n bekçisi: 8 dilin anahtar kümeleri birebir aynı olmalı; ayrıca her
// çevirinin {var} yer tutucuları EN ile eşleşmeli. `node scripts/check-i18n.cjs`
// (build zincirinde koşar — eksik anahtar buradan kaçamaz).
const { transformSync } = require('esbuild');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '..', 'src', 'i18n', 'dict.ts'), 'utf8');
const js = transformSync(src, { loader: 'ts', format: 'cjs' }).code;
const mod = { exports: {} };
new Function('module', 'exports', 'require', js)(mod, mod.exports, require);
const dict = mod.exports.dict;

const langs = Object.keys(dict);
const en = new Set(Object.keys(dict.en));
let fail = false;

for (const l of langs) {
  const keys = new Set(Object.keys(dict[l]));
  const missing = [...en].filter((k) => !keys.has(k));
  const extra = [...keys].filter((k) => !en.has(k));
  if (missing.length || extra.length) {
    fail = true;
    console.error(`[i18n] ${l}: eksik ${missing.length} ${JSON.stringify(missing.slice(0, 10))} / fazla ${extra.length} ${JSON.stringify(extra.slice(0, 10))}`);
  }
  // yer tutucu denetimi
  for (const k of keys) {
    if (!en.has(k)) continue;
    const vars = (s) => new Set([...String(s).matchAll(/\{(\w+)\}/g)].map((m) => m[1]));
    const a = vars(dict.en[k]); const b = vars(dict[l][k]);
    const miss = [...a].filter((v) => !b.has(v));
    if (miss.length) { fail = true; console.error(`[i18n] ${l}.${k}: yer tutucu eksik ${JSON.stringify(miss)}`); }
  }
}

if (fail) process.exit(1);
console.log(`[i18n] OK — ${langs.length} dil × ${en.size} anahtar, parite tam`);
