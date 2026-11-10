# Database security tests

Each `*.sql` file here is one self-contained transaction: it creates throwaway users and data,
impersonates owners and paired phones (`request.jwt.claims` + `set local role authenticated`),
checks what they can and cannot do, and ends in `ROLLBACK` — nothing is left in the database.

Run a file against the **dev** project only:
- Supabase dashboard → SQL editor → paste the whole file → Run, or
- Claude via the Supabase connector (`execute_sql`).

A pass finishes without error. A failure raises an exception whose message starts with the test id
(`T3 owner B can read shop A`).

Test user ids: owner A `…a1`, owner B `…b1`, stranger `…51` (regular users); phones `…d1`, `…d2`
(anonymous users). All use the `@test.local` domain.

Files: `010` table access/RLS, `020` owner functions, `030` pairing and phone functions, `040` closings and
suggestions, `050` owner app support, `060` staff sessions, business date and day-change time, `070` session
submit and inputs schema 2, `080` open closing (per-field writes, realtime topic auth; needs `…d2`/`…d3` phones too), `090` live submit (revision check, pinned config, `last_submit`; uses `…d2` too). `060`/`070` also create a throwaway phone `…d1`; `060` uses `…d2` as an unpaired phone.

`080` and `090` also assert the Realtime side: `realtime.send` swallows insert errors (it only logs a
WARNING) and, on a project whose `realtime.messages` has no partitions (the Realtime service creates the daily
partitions once it is used), the broadcast/policy assertions cannot run. In that case the tests raise a
`NOTICE ... SKIPPED: realtime.messages has no partitions here` and skip those blocks (080 T2 message count +
payload, 080 I2 presence-only insert policy, 090 T8 `submitted` payload); everything else still runs. A skipped
block is not a pass: check `select count(*) from pg_inherits where inhparent = 'realtime.messages'::regclass`
and re-run once it is > 0. Last full run (2026-11-10, dev) had partitions, so nothing skipped.

