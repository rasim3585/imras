-- 0153: UYUYAN DUNYA — kalp pili altyapisi (Rasim karari 2026-07-17:
-- upgrade YOK, sistem Nano butcesine sigdirilir).
-- Kanit: 09:27 UTC cokusunde sitede kullanici yoktu; makineyi yoran 7/24
-- bosa donen motorlardi (aviator_tick 1sn = gunde ~5000 issiz tur;
-- pickplay_live 2sn; pickplay_tick 60sn mac uretimi).
-- Bu dosya govde-BAGIMSIZ parca: tek satirlik nabiz tablosu + heartbeat RPC
-- + cron'larin soracagi _world_awake() kapisi. Cron fonksiyonlarina kapinin
-- takilmasi AYRI migration (once govde cekimi — CLAUDE.md kural: gormeden
-- fonksiyona dokunma).
-- FE tarafi CANLIDA: App.tsx dakikada bir app_heartbeat() cagiriyor
-- (gorunur sekmede; RPC yokken sessiz dusuyor).
-- SQL Editor: her statement TEK TEK yapistirilir.

create table if not exists public.app_presence (
  id int primary key default 1 check (id = 1),
  last_seen timestamptz not null default now()
);

insert into public.app_presence (id) values (1) on conflict do nothing;

-- RLS acik, policy yok = tablo tum rollere kapali (0073 secrets kalibi);
-- erisim yalniz asagidaki security definer fonksiyonlardan.
alter table public.app_presence enable row level security;

create or replace function public.app_heartbeat()
returns void
language sql
security definer
set search_path to 'public', 'pg_temp'
as $$
  update public.app_presence set last_seen = now() where id = 1;
$$;

revoke execute on function public.app_heartbeat() from public;

-- anon da nabiz atar: bulteni gezen ziyaretci de dunyayi uyandirmali.
-- Maliyet tek satirlik update — kotu niyetli spam bile anlamli yuk uretmez.
grant execute on function public.app_heartbeat() to anon, authenticated, service_role;

-- Cron kapisi: son 5 dakikada izleyen var mi? (cron fonksiyonlarinin basina
-- `if not public._world_awake() then return; end if;` eklenecek — 0154+)
create or replace function public._world_awake()
returns boolean
language sql
stable
security definer
set search_path to 'public', 'pg_temp'
as $$
  select coalesce(
    (select last_seen > now() - interval '5 minutes' from public.app_presence where id = 1),
    false);
$$;

-- `_` onekli: PostgREST /rpc'den kimse cagiramasin (0140 kurali)
revoke execute on function public._world_awake() from public, anon, authenticated;
