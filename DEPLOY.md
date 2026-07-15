# imras.ai'ye Yayın — Adım Adım

Uygulama saf statik Vite SPA (backend tamamen Supabase'te) → herhangi bir statik
host yeter. Öneri: **Vercel** (ücretsiz plan, otomatik build, kolay domain).
`vercel.json` hazır (SPA rewrite + asset cache). Logo/wordmark şimdilik PickPlay
olarak kalıyor (Rasim kararı) — sadece marka metni/başlık "imras".

## 1. GitHub'a repo aç + push (Rasim)
1. https://github.com/new → repo adı örn. `imras` (Private uygun) → **README/gitignore EKLEME** (boş repo).
2. Repo açılınca, aşağıdaki komutları bu klasörde çalıştır (URL'yi kendi
   kullanıcı adınla değiştir):
   ```
   git remote add origin https://github.com/<KULLANICI>/imras.git
   git push -u origin master
   ```
   (Şifre sorarsa: GitHub'da Settings → Developer settings → Personal access
   token oluştur, şifre yerine onu yapıştır. Ya da GitHub Desktop ile push et.)

## 2. Vercel'e bağla (Rasim)
1. https://vercel.com → **Continue with GitHub**.
2. "Add New → Project" → `imras` repo'sunu **Import**.
3. Framework otomatik **Vite** algılanır. Build ayarını değiştirme
   (`vite build`, output `dist`).
4. **Environment Variables** (Production + Preview + Development — üçü de):
   | Name | Value |
   |---|---|
   | `VITE_SUPABASE_URL` | `https://owhvdjmxdtdaifpzttav.supabase.co` |
   | `VITE_SUPABASE_ANON_KEY` | (yerel `.env` dosyandaki `VITE_SUPABASE_ANON_KEY` değeri — kopyala) |
5. **Deploy** → birkaç dakikada `*.vercel.app` adresinde açılır. Aç, çalıştığını gör.

## 3. Domain bağla (Rasim)
1. Vercel → Project → **Settings → Domains** → `imras.ai` ekle, sonra `www.imras.ai` ekle.
2. Domain kayıtçında (registrar) Vercel'in gösterdiği kayıtları gir:
   - `imras.ai`  → **A** `76.76.21.21`
   - `www`       → **CNAME** `cname.vercel-dns.com`
3. SSL otomatik (birkaç dk). `www` → apex yönlendirmesini Vercel Domains'te seç.

## 4. Supabase Auth URL'leri (Rasim — giriş çalışsın diye ŞART)
Supabase Dashboard → **Authentication → URL Configuration**:
- **Site URL**: `https://imras.ai`
- **Redirect URLs** (hepsini ekle):
  - `https://imras.ai/**`
  - `https://www.imras.ai/**`
  - `https://*.vercel.app/**`   (önizleme deployları)
  - `http://localhost:5173/**`  (yerel geliştirme)

Google ile giriş kullanılıyorsa: Google Cloud Console → OAuth Client →
**Authorized JavaScript origins**'e `https://imras.ai` ekle. (Redirect URI zaten
Supabase callback'i, değişmez.)

## 5. Yayın sonrası duman testi (birlikte — Claude Code)
Canlı adreste: kayıt/giriş → bülten yükleniyor mu → bir kupon oyna → Aviator
1 tur → Mines 1 el → /analiz açılıyor mu (RAS Score görünüyor mu). Sorun çıkarsa
console/network hatalarına bakarız.

## Notlar
- Anon key'in istemcide olması **normaldir** (Supabase modeli; bundle'a zaten
  girer). Güvenlik RLS + SECURITY DEFINER RPC'lerde — 0140'ta sıkılaştırıldı.
- Cron/pg_net/edge tarafında hiçbir şey değişmez; site nereden servis edilirse
  edilsin backend aynı Supabase projesi.
- `ANTHROPIC_API_KEY` Supabase secret'ı ekli olduğu için AI özellikleri
  (Ras koçu, Kupon Hakemi, Maç Önizleme) canlıda da çalışır.
