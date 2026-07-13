-- DAVRANIŞ AYNASI — sohbet mizacı. Kullanıcının KENDİ maç yorumlarından öfke/tilt
-- dili oranı. Novel içgörü: hiçbir bahis sitesi "sohbette sinirleniyorsun, bu
-- kararlarına yansır" demez. Deterministik (anahtar-kelime sezgiseli), yalnız OKUR.
create or replace function public.mirror_chat()
returns jsonb language plpgsql security definer set search_path to 'public' stable as $function$
declare v_uid uuid := auth.uid();
  n int; heated int; avg_len numeric; rec_heat numeric; rec_n int;
  tilt numeric; flags jsonb := '[]'::jsonb;
  pat text := '(kasac|yakt|sinir|rezalet|berbat|hile|iptal|saçma|sacma|çöp|cop|batır|batir|mahvet|kör|hakem|amk|sinirlen|rigged|scam|terrible|worst|robbed|garbage|trash|tilt|angry)';
begin
  if v_uid is null then return jsonb_build_object('ready', false); end if;
  select count(*), count(*) filter (where body ~* pat), avg(length(body))
    into n, heated, avg_len
  from public.match_comments where user_id = v_uid;
  if n is null or n < 8 then return jsonb_build_object('ready', false, 'rounds', coalesce(n,0), 'need', 8); end if;
  tilt := round(heated::numeric / n, 3);

  select avg((body ~* pat)::int), count(*) into rec_heat, rec_n
  from (select body from public.match_comments where user_id=v_uid order by created_at desc limit 20) r;

  if tilt >= 0.35 then
    flags := flags || jsonb_build_object('code','chat_tilt','level','warn',
      'value', jsonb_build_object('tilt', tilt, 'n', n));
  elsif tilt < 0.15 then
    flags := flags || jsonb_build_object('code','chat_calm','level','good',
      'value', jsonb_build_object('tilt', tilt, 'n', n));
  end if;
  if rec_n >= 8 and rec_heat > tilt + 0.15 then
    flags := flags || jsonb_build_object('code','chat_heating','level','warn',
      'value', jsonb_build_object('recent', round(rec_heat,3), 'overall', tilt));
  end if;

  return jsonb_build_object('ready', true, 'comments', n, 'tilt_rate', tilt,
    'avg_len', round(coalesce(avg_len,0),0), 'flags', flags);
end; $function$;

revoke all on function public.mirror_chat() from public;
revoke execute on function public.mirror_chat() from anon;
grant execute on function public.mirror_chat() to authenticated;
