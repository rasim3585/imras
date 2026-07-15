# imras.ai'ye Yayın — Adım Adım

Uygulama saf statik Vite SPA (backend tamamen Supabase'te) → herhangi bir statik
host yeter. Öneri: **Vercel** (ücretsiz plan, otomatik build, kolay domain).
`vercel.json` hazır (SPA rewrite + asset cache).

## 1. Rasim — Vercel'e ilk deploy (~10 dk)
1. https://vercel.com → GitHub ile giriş yap.
2. "Add New → Project" → bu repo'yu import et (repo GitHub'da değilse önce
   push et; istersen bu adımı birlikte yaparız).
3. Framework otomatik "Vite" algılanır. Ayar değiştirme.
4. **Environment Variables** ekle (ikisi de Production+Preview):
   - `VITE_SUPABASE_URL`  → `https://owhvdjmxdtdaifpzttav.supabase.co`
   - `VITE_SUPABASE_ANON_KEY` → (yerel `.env` dosyandaki anon key)
5. Deploy → `*.vercel.app` adresinde çalıştığını gör.

## 2. Rasim — Domain bağlama
1. Vercel → Project → Settings → Domains → `imras.ai` ekle (+ `www.imras.ai`).
2. Domain kayıtçında (registrar) Vercel'in gösterdiği kayıtları gir:
   - `imras.ai` → A `76.76.21.21`
   - `www` → CNAME `cname.vercel-dns.com`
3. SSL otomatik gelir (birkaç dakika).

## 3. Rasim — Supabase Auth ayarları (giriş çalışsın diye ŞART)
Supabase Dashboard → Authentication → URL Configuration:
- **Site URL**: `https://imras.ai`
- **Redirect URLs**'e ekle: `https://imras.ai/**`, `https://www.imras.ai/**`,
  `https://*.vercel.app/**` (önizlemeler için), `http://localhost:5173/**` (dev).

Google ile giriş kullanılıyorsa: Google Cloud Console → OAuth Client →
Authorized JavaScript origins'e `https://imras.ai` ekle. (Authorized redirect
URI zaten Supabase callback'i, değişmez.)

## 4. Sonrası (Claude Code)
- Yayın sonrası duman testi (login, kupon, aviator, mines).
- "imras / Ras" rebrand'i (logo, wordmark, i18n marka dizeleri, Ras personası)
  — RAS açılımı kararı verildikten sonra ayrı tur.

Notlar: anon key'in istemcide olması normaldir (Supabase modeli; güvenlik RLS +
SECURITY DEFINER RPC'lerde — 0140 sıkılaştırması yapıldı). Cron/edge tarafında
hiçbir şey değişmez; site nereden servis edilirse edilsin backend aynı.
