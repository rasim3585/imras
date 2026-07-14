-- 0128: Basketbol acilisina SERBEST ATIS gercekligi.
-- Eski _bb_q_reveal ceyrek skorunu yalniz 2'lik/3'luk adimlara ayiriyordu —
-- +1 hic uretilmiyordu, dolayisiyla serbest atis dramasi imkansizdi.
-- Yeni: 2'lik olaylarin ~1/5'i (deterministik) SERBEST ATIS SERISINE donusur:
-- iki AYRI +1 adimi, aralarinda ceyrek zamaninin ~%4.5'i (gercekte ~5sn) —
-- istemci iki ayri +1 pop'u gosterir, top serbest atis cizgisinden atar.
-- Toplamlar birebir korunur (f>=1'de tam qh/qa doner); f'te monoton.

create or replace function public._bb_team_reveal(q integer, f double precision, salt integer)
returns integer language plpgsql immutable as $$
declare
  n int; th int; k int; pts int; base double precision; res int := 0;
begin
  if q <= 0 then return 0; end if;
  n := least(floor(q/2.0)::int, greatest(ceil(q/3.0)::int, round(q/2.4)::int));
  if n < 1 then n := 1; end if;
  th := q - 2*n;                              -- 3'luk sayisi (olaylara serpilir)
  for k in 0 .. n-1 loop
    pts := 2 + (floor((k+1)::numeric*th/n) - floor(k::numeric*th/n))::int;
    base := (k + 0.5) / n;
    if pts = 2 and ((k*17 + q*7 + salt*3) % 5) = 2 then
      -- serbest atis serisi: iki ayri +1, bir nefes arayla
      if base <= f then res := res + 1; end if;
      if base + 0.45/n <= f then res := res + 1; end if;
    else
      if base <= f then res := res + pts; end if;
    end if;
  end loop;
  return res;
end; $$;

create or replace function public._bb_q_reveal(qh integer, qa integer, f double precision)
returns integer[] language plpgsql immutable as $$
begin
  if qh < 0 then qh := 0; end if; if qa < 0 then qa := 0; end if;
  if f >= 1 then return array[qh, qa]; end if;
  if f <= 0 then return array[0, 0]; end if;
  return array[public._bb_team_reveal(qh, f, 0), public._bb_team_reveal(qa, f, 1)];
end; $$;
