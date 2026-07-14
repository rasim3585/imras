-- 0133: Ayna+ (anket + mirror_parallel + mirror_tilt + mirror_selfgap)
-- Tam SQL apply_migration ile canliya uygulandi; govde asagida.

create table if not exists public.user_survey (
  user_id uuid primary key references auth.users(id) on delete cascade,
  team text,
  fav_game text,
  self_style text check (self_style in ('temkinli','dengeli','agresif')),
  city text,
  updated_at timestamptz not null default now()
);
alter table public.user_survey enable row level security;
drop policy if exists user_survey_own on public.user_survey;
create policy user_survey_own on public.user_survey
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- PARALEL SEN / TILT / OZ-ALGI fonksiyon govdeleri apply_migration ile canliya
-- uygulandi (2026-07-15). Kaynak dogrulama:
--   select pg_get_functiondef('public.mirror_parallel()'::regprocedure);
--   select pg_get_functiondef('public.mirror_tilt()'::regprocedure);
--   select pg_get_functiondef('public.mirror_selfgap()'::regprocedure);
-- Ozet:
--   mirror_parallel: son 300 aviator bahsi + crash_point -> gercek net vs
--     'hep 1.2/1.5/2/3x cek' stratejileri + 60 noktalik kumulatif seri (grafik).
--   mirror_tilt: son 120 bahis (aviator+slot) tek serit; kayip-sonrasi buyutme
--     isaretli; raise_loss/raise_win ortalamalari + tilt maliyeti.
--   mirror_selfgap: olculen risk skoru 0-100 (0.4*hedef istahi + 0.4*kayip
--     sonrasi buyutme + 0.2*bahis oynakligi) + anketteki oz-tanimla kiyas.
-- Ilke: sayilar deterministik; ayna yalniz OKUR (para yoluna mutasyon yok).
