-- Internal-only helpers must not be directly callable by authenticated; they are only ever
-- invoked from security-definer functions that run as the table owner. private.is_shop_owner
-- is untouched: RLS policies call it as the querying role and need EXECUTE.
revoke execute on function private.is_anonymous(), private.require_owner(uuid), private.check_config(jsonb), private.check_pin(text) from authenticated;
