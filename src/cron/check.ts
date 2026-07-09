import { createClient } from '@supabase/supabase-js';
import { errMsg } from './_shared';

// Preflight health check. Verifies each step, prints ONE line each, keeps going
// on failure (see everything, not just the first problem). NEVER prints secret
// values -- only "tanımlı" / "EKSİK". Exit 0 if all green, 1 otherwise.

let problems = 0;
const line = (label: string, msg: string) => console.log(`      ${label.padEnd(26)} ${msg}`);
const url = process.env.SUPABASE_URL;
const svc = process.env.SUPABASE_SERVICE_ROLE_KEY;
const bsdKey = process.env.BSD_API_KEY;

// [1/5] env vars (presence only, never the value)
console.log('[1/5] Ortam değişkenleri');
for (const [k, v] of [['SUPABASE_URL', url], ['SUPABASE_SERVICE_ROLE_KEY', svc], ['BSD_API_KEY', bsdKey]] as const) {
  if (!v) problems++;
  line(k, v ? 'tanımlı' : 'EKSİK');
}

// [2/5] Supabase connection
console.log('[2/5] Supabase bağlantısı');
let client: ReturnType<typeof createClient> | null = null;
if (url && svc) {
  try {
    client = createClient(url, svc, { auth: { persistSession: false } });
    const { error } = await client.from('real_fixtures').select('id', { count: 'exact', head: true });
    if (error && !/does not exist|find the table|schema cache/i.test(error.message)) { problems++; line('bağlantı', `hata: ${error.message}`); }
    else line('bağlantı', 'ok');
  } catch (e) { problems++; line('bağlantı', `hata: ${errMsg(e)}`); }
} else { problems++; line('bağlantı', 'atlandı (env eksik)'); }

// [3/5] tables
console.log('[3/5] Tablolar');
for (const t of ['real_fixtures', 'provider_sync_log']) {
  if (!client) { problems++; line(t, 'atlandı (bağlantı yok)'); continue; }
  const { count, error } = await client.from(t).select('*', { count: 'exact', head: true });
  if (error) { problems++; line(t, 'YOK'); }
  else line(t, `var (${count ?? 0} satır)`);
}

// [4/5] functions (via the PostgREST OpenAPI -- exact for API-exposed functions;
// internal `_`-prefixed ones aren't exposed and are noted, not failed)
console.log('[4/5] Fonksiyonlar');
const FNS = ['_market_odds_ft_real', 'real_fixture_odds', 'settle_real_fixture', '_settle_outcome', '_settle_ready_coupons', 'place_coupon_v2'];
if (!url || !svc) { problems++; line('introspection', 'atlandı (env eksik)'); }
else {
  try {
    const r = await fetch(`${url}/rest/v1/`, { headers: { apikey: svc, Authorization: `Bearer ${svc}` } });
    const spec = await r.json() as { paths?: Record<string, unknown> };
    const exposed = new Set(Object.keys(spec.paths ?? {}).filter((p) => p.startsWith('/rpc/')).map((p) => p.slice(5)));
    for (const fn of FNS) {
      if (exposed.has(fn)) line(fn, 'var');
      else if (fn.startsWith('_')) line(fn, "API'de görünmüyor (internal — SQL'den doğrula)");
      else { problems++; line(fn, 'YOK'); }
    }
  } catch (e) { problems++; line('introspection', `hata: ${errMsg(e)}`); }
}

// [5/5] BSD connection
console.log('[5/5] BSD bağlantısı');
if (!bsdKey) { problems++; line('/events/live/', 'atlandı (BSD_API_KEY eksik)'); }
else {
  try {
    const base = (process.env.BSD_BASE_URL ?? 'https://sports.bzzoiro.com').replace(/\/$/, '');
    const r = await fetch(`${base}/api/v2/events/live/`, { headers: { Authorization: `Token ${bsdKey}` } });
    if (r.status === 200) { const j = await r.json() as { count?: number }; line('/events/live/', `ok (${j.count ?? 0} canlı maç)`); }
    else if (r.status === 401) { problems++; line('/events/live/', 'ANAHTAR GEÇERSİZ (401)'); }
    else { problems++; line('/events/live/', `${r.status} — ${(await r.text()).slice(0, 200)}`); }
  } catch (e) { problems++; line('/events/live/', `hata: ${errMsg(e)}`); }
}

// summary
console.log('');
if (problems === 0) console.log('Hepsi yeşil. Devam edebilirsin.');
else console.log(`${problems} sorun var. Yukarı bak.`);
process.exit(problems === 0 ? 0 : 1);
