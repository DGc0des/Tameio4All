-- Plan 4a: owner app support — shop rename, unlock staff without a PIN change, pairing-code cleanup.

-- Owners may rename their own shops (the length CHECK on shops.name still applies).
grant update (name) on public.shops to authenticated;
create policy shops_owner_update on public.shops for update to authenticated
  using (private.is_shop_owner(id)) with check (private.is_shop_owner(id));

-- Clears a lockout without changing the PIN. Missing and foreign ids both answer not_owner,
-- so staff ids can't be probed.
create function public.unlock_staff(p_staff_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
declare
  v_shop uuid;
begin
  select shop_id into v_shop from public.staff where id = p_staff_id;
  if v_shop is null then
    raise exception 'not_owner' using errcode = '42501';
  end if;
  perform private.require_owner(v_shop);
  update public.staff set failed_attempts = 0, locked_until = null where id = p_staff_id;
end $$;
revoke all on function public.unlock_staff(uuid) from public, anon;
grant execute on function public.unlock_staff(uuid) to authenticated;

-- Same as before, but first deletes this shop's expired or used codes (they can never be redeemed).
create or replace function public.create_pairing_code(p_shop_id uuid) returns text
language plpgsql security definer set search_path = '' as $$
declare
  v_alphabet constant text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes bytea := extensions.gen_random_bytes(8);
  v_code text := '';
begin
  perform private.require_owner(p_shop_id);
  delete from public.pairing_codes where shop_id = p_shop_id and (used_at is not null or expires_at < now());
  for i in 0..7 loop
    v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
  end loop;
  insert into public.pairing_codes (code_hash, shop_id, created_by, expires_at)
  values (encode(extensions.digest(v_code, 'sha256'), 'hex'), p_shop_id, auth.uid(), now() + interval '10 minutes');
  return v_code;
end $$;
revoke all on function public.create_pairing_code(uuid) from public, anon;
grant execute on function public.create_pairing_code(uuid) to authenticated;
