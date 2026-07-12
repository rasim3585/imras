-- 0084_virtual_league_form_ratings.sql
-- Sanal futbol: form-duyarlı oranlar — Elo-tarzı reyting kayması.
--
-- SORUN: reytingler (dolayısıyla oranlar) SABİTti → form/H2H gösteriliyor ama
-- FİYATLANMIYORdu. Sevilla üst üste kazansa da base oranını veriyordu.
--
-- ÇÖZÜM: her maç bitince takımların atak/defans reytingi SONUCA göre kayar:
--   attack  += K*(attılan_gol   - beklenen)   (beklenenden çok attı → atak↑)
--   defense += K*(yenilen_gol   - beklenen)   (beklenenden çok yedi → defans↑ = kötü)
-- Beklenen = maçın lambda'sı (zaten rakip gücünü içerir → güçlüyü yenmek otomatik
-- daha çok puan). Taban reytinge doğru ortalama-dönüş (R) ile sınırlı → runaway yok.
-- Form böylece sonraki maçların lambda'sına, oradan oranlara doğal akar.
--
-- Sadece takım-id'li (reytingli sanal) maçlarda çalışır; gerçek maçlar vteams'e
-- dokunmaz. _finalize_match sanal maç yaşam-döngüsüdür → hook oraya eklenir.

-- 1) Taban (çapa) reytingleri: mevcut seed değerleri intrinsik kalite ------------
alter table public.vteams
  add column if not exists attack_base  double precision,
  add column if not exists defense_base double precision;

update public.vteams set attack_base = attack, defense_base = defense
  where attack_base is null or defense_base is null;

alter table public.vteams
  alter column attack_base  set not null,
  alter column defense_base set not null;

-- 2) Bir maçtan sonra iki takımın reytingini güncelle -------------------------
create or replace function public._vupdate_ratings(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  m public.matches;
  K   constant double precision := 0.04;   -- öğrenme oranı
  R   constant double precision := 0.06;   -- taban reytinge ortalama-dönüş
  LO  constant double precision := 0.55;   -- reyting alt sınır
  HI  constant double precision := 1.65;   -- reyting üst sınır
  exp_h double precision;   -- ev sahibinin beklenen attığı
  exp_a double precision;   -- deplasmanın beklenen attığı
begin
  select * into m from public.matches where id = p_match_id;
  if m.home_team_id is null or m.away_team_id is null
     or m.home_score is null or m.lambda_home is null then
    return;
  end if;

  exp_h := m.lambda_home;
  exp_a := m.lambda_away;

  -- EV SAHİBİ: attığı vs beklenen (atak), yediği vs beklenen (defans).
  update public.vteams t
     set attack  = greatest(LO, least(HI, t.attack  + K*(m.home_score - exp_h) - R*(t.attack  - t.attack_base))),
         defense = greatest(LO, least(HI, t.defense + K*(m.away_score - exp_a) - R*(t.defense - t.defense_base)))
   where t.id = m.home_team_id;

  -- DEPLASMAN
  update public.vteams t
     set attack  = greatest(LO, least(HI, t.attack  + K*(m.away_score - exp_a) - R*(t.attack  - t.attack_base))),
         defense = greatest(LO, least(HI, t.defense + K*(m.home_score - exp_h) - R*(t.defense - t.defense_base)))
   where t.id = m.away_team_id;
end;
$function$;

-- 3) _finalize_match'e hook (gerisi BİREBİR korundu) --------------------------
create or replace function public._finalize_match(p_match_id uuid)
returns void
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  v_match public.matches;
  v_out   jsonb;
begin
  select * into v_match from public.matches where id = p_match_id for update;
  if not found or v_match.status = 'finished' then return; end if;
  -- Model A: no early finish — the match ends on the central clock, not on demand
  if now() < v_match.starts_at + make_interval(secs => coalesce(v_match.duration_secs, 100)) then
    return;
  end if;

  v_out := public._ensure_outcome(p_match_id);   -- the one, stored outcome

  update public.matches
     set status = 'finished',
         result = v_out ->> 'result',
         home_score = (v_out ->> 'home_score')::int,
         away_score = (v_out ->> 'away_score')::int,
         timeline = v_out -> 'events'
   where id = p_match_id;

  perform public._score_match(p_match_id);
  perform public._settle_markets(p_match_id);
  perform public._vupdate_ratings(p_match_id);   -- form-duyarlı reyting kayması
end;
$function$;
