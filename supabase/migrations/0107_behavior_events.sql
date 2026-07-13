-- DAVRANIŞ AYNASI — Faz 0: moat yakalama. Üründen bağımsız, append-only olay
-- akışı. Asıl değer KARAR-ÖNCESİ sinyaller (tereddüt, kupon bozma, market
-- görüntüleme) — kaydedilmezse geri gelmez, rakip retroaktif ekleyemez. Mevcut
-- ürün tabloları SÖKÜLMEZ; bu tablo SADECE analiz/sinyal için. Yüksek hacim →
-- batch yazıcı; canlı agregasyon YOK (EWMA profil Faz 1'de). RLS: kendi olayın.

create table if not exists public.behavior_events (
  id          bigint generated always as identity primary key,
  user_id     uuid not null references auth.users(id) on delete cascade,
  ts          timestamptz not null default now(),
  product     text not null,
  event_type  text not null,
  payload     jsonb not null default '{}'::jsonb,
  context     jsonb not null default '{}'::jsonb,
  session_id  uuid,
  created_at  timestamptz not null default now()
);

create index if not exists behavior_events_user_ts on public.behavior_events (user_id, ts desc);
create index if not exists behavior_events_user_pet on public.behavior_events (user_id, product, event_type, ts desc);

alter table public.behavior_events enable row level security;
drop policy if exists behavior_events_select_own on public.behavior_events;
create policy behavior_events_select_own on public.behavior_events
  for select to authenticated using (user_id = auth.uid());

-- Batch olay yazıcı. Frontend olayları tamponlar, tek çağrıda basar. SECURITY
-- DEFINER → RLS'i baypas edip auth.uid() adına yazar (yalnız kendi verisi).
create or replace function public.log_events(p_events jsonb)
returns integer language plpgsql security definer set search_path to 'public'
as $function$
declare v_uid uuid := auth.uid(); n int;
begin
  if v_uid is null or p_events is null or jsonb_typeof(p_events) <> 'array' then return 0; end if;
  insert into public.behavior_events (user_id, ts, product, event_type, payload, context, session_id)
  select v_uid,
         coalesce((e->>'ts')::timestamptz, now()),
         e->>'product', e->>'event_type',
         coalesce(e->'payload', '{}'::jsonb),
         coalesce(e->'context', '{}'::jsonb),
         nullif(e->>'session_id','')::uuid
  from jsonb_array_elements(p_events) e
  where e ? 'product' and e ? 'event_type'
    and length(coalesce(e->>'event_type','')) <= 40
    and length(coalesce(e->>'product','')) <= 24;
  get diagnostics n = row_count;
  return n;
end;
$function$;

revoke all on function public.log_events(jsonb) from public;
revoke execute on function public.log_events(jsonb) from anon;
grant execute on function public.log_events(jsonb) to authenticated;
