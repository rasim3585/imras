-- 0129: Serbest atislar TEK SIRALI diziye gomuldu (tek top ilkesi geri).
-- 0128 takimlari bagimsiz zaman-kapiladigi icin iki takim ayni poll'de sayi
-- atabiliyordu (canli kanitta yakalandi: +2 pop'u rakibin 3'luk noktasindan
-- oynadi). 0126'nin yaklasimi geri: iki takimin adimlari zamana gore TEK
-- diziye birlesir, f ilerledikce TEKER TEKER acilir — ayni anda iki takim
-- sayi atamaz. Serbest atis ciftleri (+1,+1) dizide ardisik iki adim.

create or replace function public._bb_q_reveal(qh integer, qa integer, f double precision)
returns integer[] language plpgsql immutable as $$
declare
  ts double precision[] := '{}'; tm int[] := '{}'; tp int[] := '{}';
  hp int := 0; ap int := 0; total int; kk int; i int;
  q int; n int; th int; k int; pts int; base double precision; t int;
  used boolean[]; mi int; j int;
begin
  if qh < 0 then qh := 0; end if; if qa < 0 then qa := 0; end if;
  if f >= 1 then return array[qh, qa]; end if;
  if f <= 0 then return array[0, 0]; end if;

  -- her takim icin adimlar: 2'lik / 3'luk / serbest atis cifti (iki ayri +1);
  -- deplasman yarim slot kaydirilir ki zamanlar catismasin
  for t in 0 .. 1 loop
    q := case when t = 0 then qh else qa end;
    if q > 0 then
      n := least(floor(q/2.0)::int, greatest(ceil(q/3.0)::int, round(q/2.4)::int));
      if n < 1 then n := 1; end if;
      th := q - 2*n;
      for k in 0 .. n-1 loop
        pts := 2 + (floor((k+1)::numeric*th/n) - floor(k::numeric*th/n))::int;
        base := (k + 0.5 + case when t = 1 then 0.21 else 0 end) / (n + 0.42);
        if pts = 2 and ((k*17 + q*7 + t*3) % 5) = 2 then
          ts := ts || base;                      tm := tm || t; tp := tp || 1;
          ts := ts || (base + 0.4 / (n + 0.42)); tm := tm || t; tp := tp || 1;
        else
          ts := ts || base; tm := tm || t; tp := tp || pts;
        end if;
      end loop;
    end if;
  end loop;

  total := coalesce(array_length(ts, 1), 0);
  if total = 0 then return array[0, 0]; end if;

  -- zaman sirasiyla ilk floor(f*total) adim acilir (secim: kucukten buyuge)
  kk := least(total, floor(f * total)::int);
  used := array_fill(false, array[total]);
  for i in 1 .. kk loop
    mi := 0;
    for j in 1 .. total loop
      if not used[j] and (mi = 0 or ts[j] < ts[mi]) then mi := j; end if;
    end loop;
    exit when mi = 0;
    used[mi] := true;
    if tm[mi] = 0 then hp := hp + tp[mi]; else ap := ap + tp[mi]; end if;
  end loop;
  return array[hp, ap];
end; $$;

-- 0128'in ara yardimcisi artik kullanilmiyor — ikilik birakma
drop function if exists public._bb_team_reveal(integer, double precision, integer);
