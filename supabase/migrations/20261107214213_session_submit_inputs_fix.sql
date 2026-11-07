-- Applied to dev as migration session_submit_inputs_fix (version 20261107214213): a missing
-- `expenses` key made `jsonb_typeof(...) <> 'array'` NULL, so the CASE fell through and
-- the shape was accepted. Idempotent create-or-replace.
create or replace function private.inputs_shape_ok(p_inputs jsonb) returns boolean
language sql immutable set search_path = '' as $$
  select coalesce(
    jsonb_typeof(p_inputs) = 'object'
    and p_inputs -> 'schema' in ('1'::jsonb, '2'::jsonb)
    and jsonb_typeof(p_inputs -> 'counts') = 'object'
    and jsonb_typeof(p_inputs -> 'channelCents') = 'object'
    and pg_column_size(p_inputs) <= 65536
    and case
      when jsonb_typeof(p_inputs -> 'expenses') is distinct from 'array' then false
      when p_inputs -> 'schema' = '1'::jsonb then true
      else not exists (
        select 1 from jsonb_array_elements(p_inputs -> 'expenses') e
        where not coalesce(
          jsonb_typeof(e) = 'object'
          and jsonb_typeof(e -> 'id') = 'string'
          and char_length(e ->> 'id') between 1 and 64
          and jsonb_typeof(e -> 'description') = 'string'
          and jsonb_typeof(e -> 'cents') = 'number'
          and jsonb_typeof(e -> 'addedBy') = 'object'
          and case e -> 'addedBy' ->> 'kind'
                when 'owner' then true
                when 'staff' then jsonb_typeof(e -> 'addedBy' -> 'id') = 'string'
                  and (e -> 'addedBy' ->> 'id') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                else false
              end,
          false))
    end,
    false);
$$;

revoke all on function private.inputs_shape_ok(jsonb) from public, anon, authenticated;
