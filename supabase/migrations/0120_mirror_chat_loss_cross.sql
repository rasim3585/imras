-- DAVRANIŞ AYNASI — sohbet tilt × bahis sonucu ÇAPRAZI. "Kaybettikten hemen sonra
-- (2 saat içi) yazdığın yorumlarda X× daha çok sinirleniyorsun." Asıl güç bu çapraz:
-- duygu (sohbet) + sonuç (kupon) birleşimi = tilt spiralinin kanıtı. Yalnız OKUR.
create or replace function public.mirror_chat()
returns jsonb language plpgsql security definer set search_path to 'public' stable as $function$
declare v_uid uuid := auth.uid();
  n int; heated int; avg_len numeric; rec_heat numeric; rec_n int;
  tilt numeric; flags jsonb := '[]'::jsonb;
  n_loss int; tilt_loss numeric; n_oth int; tilt_oth numeric; ratio numeric;
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

  -- ÇAPRAZ: her yorumdan önceki 2 saatte sonuçlanan son kupon 'lost' mu?
  with cm as (
    select (c.body ~* pat) tl,
      (select cp.status from public.coupons cp
         where cp.user_id = v_uid and cp.settled_at is not null
           and cp.settled_at < c.created_at and cp.settled_at > c.created_at - interval '2 hours'
         order by cp.settled_at desc limit 1) last_status
    from public.match_comments c where c.user_id = v_uid
  )
  select count(*) filter (where last_status='lost'),
         avg(tl::int) filter (where last_status='lost'),
         count(*) filter (where last_status is distinct from 'lost'),
         avg(tl::int) filter (where last_status is distinct from 'lost')
    into n_loss, tilt_loss, n_oth, tilt_oth from cm;

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
  if coalesce(n_loss,0) >= 5 and coalesce(tilt_loss,0) >= 0.30
     and tilt_loss >= greatest(coalesce(tilt_oth,0), 0.05) * 1.5 then
    ratio := round(tilt_loss / greatest(coalesce(tilt_oth,0), 0.05), 1);
    flags := flags || jsonb_build_object('code','loss_tilt','level','warn',
      'value', jsonb_build_object('loss', round(tilt_loss,3), 'other', round(coalesce(tilt_oth,0),3), 'ratio', ratio));
  end if;

  return jsonb_build_object('ready', true, 'comments', n, 'tilt_rate', tilt,
    'avg_len', round(coalesce(avg_len,0),0),
    'tilt_after_loss', round(coalesce(tilt_loss,0),3), 'tilt_other', round(coalesce(tilt_oth,0),3),
    'flags', flags);
end; $function$;
