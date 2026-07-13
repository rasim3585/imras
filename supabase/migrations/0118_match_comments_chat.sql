-- CANLI SOHBET: maç sırasında kullanıcı yorumları (Nesine "Canlı Sohbet" esinli).
-- Sosyal etkileşim + retention + DAVRANIŞ AYNASI için altın veri (kullanıcı tilt/
-- heyecan anında ne yazıyor). Yorum metni ayrıca behavior_events'e loglanır (moat).
-- Okuma herkese açık (izleyen görebilir), yazma auth + RPC (rate-limit).

create table if not exists public.match_comments (
  id         bigint generated always as identity primary key,
  match_id   uuid not null,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  username   text not null,
  body       text not null,
  created_at timestamptz not null default now()
);
create index if not exists match_comments_match_ts on public.match_comments (match_id, created_at desc);

alter table public.match_comments enable row level security;
drop policy if exists mc_select_all on public.match_comments;
create policy mc_select_all on public.match_comments for select using (true);
-- doğrudan insert yok; yalnız RPC (security definer) yazar.

-- Yorum gönder: auth + uzunluk + basit rate-limit (3sn). Kullanıcı adını profilden alır.
create or replace function public.post_match_comment(p_match_id uuid, p_body text)
returns public.match_comments
language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); v_name text; v_last timestamptz; v_row public.match_comments;
begin
  if v_uid is null then raise exception 'auth_required'; end if;
  p_body := btrim(p_body);
  if length(p_body) = 0 then raise exception 'empty'; end if;
  if length(p_body) > 200 then p_body := left(p_body, 200); end if;
  select username into v_name from public.profiles where id = v_uid;
  select max(created_at) into v_last from public.match_comments where user_id = v_uid;
  if v_last is not null and v_last > now() - interval '3 seconds' then raise exception 'too_fast'; end if;
  insert into public.match_comments (match_id, user_id, username, body)
  values (p_match_id, v_uid, coalesce(v_name, 'player'), p_body)
  returning * into v_row;
  return v_row;
end;
$function$;

grant select on public.match_comments to anon, authenticated;
revoke all on function public.post_match_comment(uuid, text) from public;
revoke execute on function public.post_match_comment(uuid, text) from anon;
grant execute on function public.post_match_comment(uuid, text) to authenticated;

-- Realtime: yeni yorumlar canlı aksın.
alter publication supabase_realtime add table public.match_comments;
