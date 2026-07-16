-- 0150: set_username "player_xxxxxxxx" tuzagi (auth denetimi B4).
-- Kok neden: RPC provisional deseni yasaklamiyordu; kullanici "player_deadbeef"
-- secerse RPC basarili donuyor ama FE (AuthContext PROVISIONAL_USERNAME regex)
-- onu hala gecici sayiyor -> UsernameScreen sonsuza dek geri geliyor.
-- Tek degisiklik: provisional desen reddi (+ mevcut kurallar aynen).
-- Govde 0003_functions.sql'den birebir alinmistir (gorulmeden dokunulmadi).

create or replace function public.set_username(p_username text)
returns void
language plpgsql
security definer
set search_path = public
as $fn$
declare
  v_uid uuid := auth.uid();
begin
  if v_uid is null then
    raise exception 'Not authenticated';
  end if;
  if p_username !~ '^[A-Za-z0-9_]{3,20}$' then
    raise exception 'Username must be 3-20 characters: letters, numbers, underscore';
  end if;
  -- gecici tanitici deseni kullanici adi OLARAK secilemez (player_ + 8 hex)
  if p_username ~* '^player_[0-9a-f]{8}$' then
    raise exception 'Username must be 3-20 characters: letters, numbers, underscore';
  end if;

  update public.profiles set username = p_username where id = v_uid;

exception when unique_violation then
  raise exception 'That username is already taken';
end;
$fn$;
