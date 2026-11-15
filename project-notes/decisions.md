---
updated: 2026-11-16
---
# Decisions

Seeded from CLAUDE.md, PROJECT_STATUS.md and git history. Back to [[index]].

- **2026-09-28** — Pure `src/core` with integer cents; closings store raw inputs + `config_id`, never totals.
  Reason (CLAUDE.md): staff cannot fake a total; old closings keep their formulas.
- **2026-09-28** — Shop configs are immutable versions with a `schema` field. Reason: stored JSON is read back
  untrusted; validators reject mismatched shapes as `bad_shape`.
- **2026-09-29** — Supabase with RLS on every table, phones only via security-definer RPCs, identity only from
  `auth.uid()`/`auth.jwt()`. Reason: trust boundary — nothing that must not be faked lives in the client.
- **(Plan 2 / Plan 1 review)** — Expense suggestions learned per shop (`buildSupplierHistory`), hardcoded
  supplier list removed (M4). Reason: supplier names differ per shop; no shop's data in the code.
- **2026-11-07** — Αποβάρα removed from the register; `tareItems` kept in `ShopConfig`. Reason: product decision
  (PROJECT_STATUS); full removal would need a schema bump.
- **2026-11-08 (stage 2)** — Live shared closing with per-field last-write-wins + optional stale check, offline
  replay per author, revision "+1 rule" for submit. Reason: several phones and the owner edit one day at once.
- **2026-11-11 (stage 3)** — `closings` is an append-only version log; owner corrections are new rows.
  Reason: history must never lose the original submission.
- **2026-11-11 (stage 4)** — Permanent store link/QR/code (`join_shop`) replaces single-use pairing codes;
  «Αφαίρεση» is cleanup, not a ban. Reason: spec `2026-11-11-store-link-entry-design.md` (unverified detail).
- **2026-11-14 (security)** — 6-digit PINs with hard cutover (H24); escalating two-track PIN lockout per trusted
  phone (M39); owner caps on shops/staff/config versions (M41); field writes limited to the pinned config (M42).
- **2026-11-14 (legal)** — Erasure keeps staff rows as tombstones (closings reference them); closings leave the DB
  only with their whole shop; daily purge of stale sessions/anonymous users (LG2). Real shop name removed from
  code (LG8); generated third-party notices (LG9).
