-- 0085_seed_no_overlap_teams.sql
-- Sanal futbol inandırıcılık: aynı takım aynı anda çakışan iki maçta olmasın.
--
-- SORUN: seed_matches rastgele eşleştiriyordu; maçlar 8 dk (2 slot) sürüp
-- bitişik slotlarda aynı takım seçilince aynı takım AYNI ANDA 2 canlı maçta
-- görünüyordu (ör. "Napoli (Onur)" ve "Napoli (Viktor)" ikisi de live).
--
-- ÇÖZÜM: yeni maç için takım seçerken, bu maçın zaman penceresiyle ÇAKIŞAN
-- (starts_at farkı < 480sn) bitmemiş maçlarda meşgul olan takımları hariç tut.
-- 34 takım, en fazla ~12 meşgul → daima yeterli boş takım.
-- (Yapının geri kalanı 0082 ile birebir; sadece takım seçimi değişti.)

create or replace function public.seed_matches(p_target integer default 10)
returns integer
language plpgsql
security definer
set search_path to 'public'
as $function$
declare
  MU        constant double precision := 1.32;
  HOME_ADV  constant double precision := 1.12;
  v_base  bigint := (floor(extract(epoch from now()) / 240) * 240)::bigint;
  v_round timestamptz;
  v_off   int; v_have int; v_make int; i int; v_total int := 0;
  v_busy  smallint[];
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
      -- Bu maçın penceresiyle çakışan bitmemiş maçlarda meşgul takımlar.
      -- (İç döngüde tekrar hesaplanır → aynı slotta eklenen maçları da görür.)
      select coalesce(array_agg(distinct t), '{}') into v_busy from (
        select home_team_id as t from public.matches
          where status <> 'finished' and home_team_id is not null
            and abs(extract(epoch from (starts_at - v_round))) < 480
        union
        select away_team_id from public.matches
          where status <> 'finished' and away_team_id is not null
            and abs(extract(epoch from (starts_at - v_round))) < 480
      ) b;

      select id, name, attack, defense into v_hid, v_home, v_att_h, v_def_h
        from public.vteams where id <> all(v_busy) order by random() limit 1;
      select id, name, attack, defense into v_aid, v_away, v_att_a, v_def_a
        from public.vteams where id <> all(v_busy) and id <> v_hid order by random() limit 1;

      -- Boş takım kalmadıysa (olası değil, 34 takım) bu slotu atla.
      if v_hid is null or v_aid is null then exit; end if;

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