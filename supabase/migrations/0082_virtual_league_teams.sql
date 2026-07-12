-- 0082_virtual_league_teams.sql
-- Sanal futbol: kalıcı lig — Faz 3a (temel).
--
-- SORUN: seed_matches takım gücünü HER MAÇTA rastgele veriyordu
-- (v_tot=2.0+rand*1.6, v_ratio=0.80+rand*1.20) → Arsenal bir maçta güçlü,
-- ötekinde zayıf. Süreklilik yok → standings/form/H2H anlamsız.
--
-- ÇÖZÜM: takımların KALICI atak/defans reytingi (vteams). Lambdalar bu
-- reytingden türer → güç maçtan maça sabit. Bu, standings/form/H2H'nin
-- (biriken gerçek sonuçlardan) anlamlı olmasının önkoşulu.
--
-- Reytingler sunucu-gizli: vteams RLS açık + policy YOK (aviator secret'ları
-- gibi anon'a tamamen kapalı). Frontend istatistikleri SECURITY DEFINER RPC'ler
-- üzerinden görür (Faz 3b); "true strength" istemciye sızmaz → temiz veri.

-- 1) Kalıcı takım tablosu -----------------------------------------------------
create table if not exists public.vteams (
  id          smallint primary key,
  name        text not null unique,
  short_name  text not null,
  attack      double precision not null,   -- gol-atma çarpanı (~0.80..1.40)
  defense     double precision not null    -- gol-yeme çarpanı (~0.70..1.20, DÜŞÜK = iyi savunma)
);

alter table public.vteams enable row level security;
-- policy YOK → anon/authenticated kapalı; sadece SECURITY DEFINER fonksiyonlar okur.

insert into public.vteams (id, name, short_name, attack, defense) values
  (1,  'Man City',    'MCI', 1.40, 0.70),
  (2,  'Real Madrid', 'RMA', 1.40, 0.72),
  (3,  'Bayern',      'BAY', 1.38, 0.74),
  (4,  'Liverpool',   'LIV', 1.32, 0.78),
  (5,  'Barcelona',   'BAR', 1.32, 0.80),
  (6,  'PSG',         'PSG', 1.34, 0.82),
  (7,  'Inter',       'INT', 1.24, 0.80),
  (8,  'Arsenal',     'ARS', 1.26, 0.82),
  (9,  'Man United',  'MUN', 1.18, 0.90),
  (10, 'Chelsea',     'CHE', 1.18, 0.88),
  (11, 'Atletico',    'ATM', 1.12, 0.78),
  (12, 'Napoli',      'NAP', 1.22, 0.86),
  (13, 'Leverkusen',  'LEV', 1.24, 0.86),
  (14, 'Dortmund',    'DOR', 1.26, 0.92),
  (15, 'Tottenham',   'TOT', 1.20, 0.96),
  (16, 'Juventus',    'JUV', 1.08, 0.82),
  (17, 'Milan',       'MIL', 1.14, 0.90),
  (18, 'Newcastle',   'NEW', 1.12, 0.90),
  (19, 'Aston Villa', 'AVL', 1.12, 0.94),
  (20, 'Benfica',     'BEN', 1.16, 0.90),
  (21, 'Porto',       'POR', 1.10, 0.88),
  (22, 'Brighton',    'BHA', 1.08, 1.00),
  (23, 'West Ham',    'WHU', 1.02, 1.02),
  (24, 'Villarreal',  'VIL', 1.06, 0.98),
  (25, 'Roma',        'ROM', 1.04, 0.90),
  (26, 'Leipzig',     'RBL', 1.16, 0.94),
  (27, 'Ajax',        'AJA', 1.12, 0.98),
  (28, 'Marseille',   'OM',  1.08, 0.98),
  (29, 'Sevilla',     'SEV', 1.00, 1.00),
  (30, 'Lyon',        'LYO', 1.02, 1.02),
  (31, 'Celtic',      'CEL', 1.10, 1.00),
  (32, 'Everton',     'EVE', 0.92, 1.06),
  (33, 'Valencia',    'VAL', 0.94, 1.08),
  (34, 'Leeds',       'LEE', 0.90, 1.12)
on conflict (id) do nothing;

-- 2) matches → takım FK'leri (eski maçlarda null, yeni maçlarda dolu) ----------
alter table public.matches
  add column if not exists home_team_id smallint references public.vteams(id),
  add column if not exists away_team_id smallint references public.vteams(id);

-- 3) seed_matches: reyting-tabanlı (yapı birebir korundu; SADECE takım seçimi +
--    lambda türetimi + takım id yazımı değişti) ------------------------------
create or replace function public.seed_matches(p_target integer default 10)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  -- lig ortalaması + ev avantajı (gol beklentisi kalibrasyonu)
  MU        constant double precision := 1.32;
  HOME_ADV  constant double precision := 1.12;
  v_base  bigint := (floor(extract(epoch from now()) / 240) * 240)::bigint;
  v_round timestamptz;
  v_off   int; v_have int; v_make int; i int; v_total int := 0;
  v_hid   smallint; v_aid smallint;
  v_home  text; v_away text;
  v_att_h double precision; v_def_h double precision;
  v_att_a double precision; v_def_a double precision;
  v_l1    double precision;
  v_l2    double precision;
  v_probs jsonb;
  v_id    uuid;
begin
  for v_off in -2 .. 5 loop
    v_round := to_timestamp(v_base + v_off * 240);
    if v_round + make_interval(secs => 480) <= now() then continue; end if;

    select count(*) into v_have from public.matches
     where status <> 'finished'
       and abs(extract(epoch from (starts_at - v_round))) < 5;
    v_make := greatest(0, 3 - v_have);

    for i in 1 .. v_make loop
      -- İki FARKLI kalıcı takım çek (güç artık sabit reytingden gelir).
      select id, name, attack, defense into v_hid, v_home, v_att_h, v_def_h
        from public.vteams order by random() limit 1;
      select id, name, attack, defense into v_aid, v_away, v_att_a, v_def_a
        from public.vteams where id <> v_hid order by random() limit 1;

      -- Dixon-Coles tarzı: lambda = MU * atak * rakip_defans (+ ev avantajı).
      -- Güç KALICI → aynı eşleşme her zaman benzer oran verir.
      v_l1 := MU * v_att_h * v_def_a * HOME_ADV;
      v_l2 := MU * v_att_a * v_def_h;

      v_probs := public._probs_from_lambda(v_l1, v_l2);

      insert into public.matches
        (sport, home_team, away_team, home_team_id, away_team_id, starts_at, status,
         lambda_home, lambda_away,
         true_probabilities, display_odds, secret_outcome, duration_secs)
      values
        ('football', v_home, v_away, v_hid, v_aid, v_round, 'upcoming',
         v_l1, v_l2,
         v_probs,
         public._make_display_odds(
           (v_probs ->> 'home')::double precision,
           (v_probs ->> 'draw')::double precision,
           (v_probs ->> 'away')::double precision),
         public._make_outcome(v_l1, v_l2),
         480)
      returning id into v_id;

      perform public._ensure_markets(v_id);
      v_total := v_total + 1;
    end loop;
  end loop;

  return v_total;
end;
$function$;
