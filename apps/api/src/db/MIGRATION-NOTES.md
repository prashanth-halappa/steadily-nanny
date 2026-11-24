# D1 migration notes (Phase 1 → Phase 2 handoff)

The working spec for Phase 2. It covers what the Postgres schema did that D1 no
longer does, and exactly how to rebuild each of the 11 RPCs. Source of truth
for the end state is a `pg_dump` of the local stack at migration 112, plus 113
added by hand. The RPC bodies below are transcribed from that dump.

Files: `src/db/schema/*.ts` (Drizzle), `migrations/0000_baseline.sql`
(generated), `migrations/0001_triggers.sql` (hand-written), `src/db/errors.ts`
(`mapDbError`), `src/db/localDate.ts`. Tests: `tests/unit/db/`.

---

## 1. Schema conventions

- **42 tables**: 38 app tables plus Better Auth `user`, `session`, `account` and
  `verification` (`email_log` was dropped in 0002 with the email domain).
  `user_profiles.user_id` and `user_beta_overrides.user_id` reference
  `user.id` with `ON DELETE CASCADE`.
  Everything else hangs off `user_profiles`, as before. Deleting a `user` row
  therefore replaces `auth.admin.deleteUser`, and the cascades are tested.
- **JS keys = snake_case column names** on app tables, so Drizzle rows have the
  same shape supabase-js returned (`row.household_id`). Better Auth tables use
  camelCase keys over snake_case columns, which is what its adapter needs.
  Their dates are `timestamp_ms` integers.
- **uuid → TEXT** with `$defaultFn(() => crypto.randomUUID())`, which is app-side
  only. Raw SQL inserts must pass `id` themselves. The same goes for `ical_uid`.
- **timestamptz → TEXT ISO-8601 UTC.** The SQL default is
  `strftime('%Y-%m-%dT%H:%M:%fZ','now')`, which has exactly the
  `new Date().toISOString()` shape. **Always write instants with
  `toISOString()`.** Plain `.eq/.gte/.lt` comparisons on these columns are
  text comparisons, and so are the shift window unique indexes. A
  `+00:00`-suffixed or ms-less string sorts differently and will dodge a
  unique index. The CHECKs and overlap triggers use `julianday()`, so they are
  format-robust; app queries are not.
- `household_invites.expires_at` defaults to now + 30 days in SQL.
- **date → TEXT `YYYY-MM-DD`; time → TEXT** (`HH:MM` or `HH:MM:SS`, compared
  lexically, so keep one format per column. Postgres returned `HH:MM:SS`).
- **Money is INTEGER minor units, unchanged.** Multipliers (`numeric(3,2)`),
  `expenses.miles`, latitude/longitude and `job_runs.peak_memory_mb` are
  **REAL**. supabase-js already returned them as JS numbers.
- **jsonb and arrays → TEXT `{mode:'json'}`.** `exdates`, `dates` and
  `disabled_types` are JSON string arrays. Postgres array operators in app
  queries (`.contains`, `cs.`, `@>`) need rewriting to `json_each`, or to
  filtering in JS.
- **boolean → INTEGER `{mode:'boolean'}`.**
- **CHECKs ported 1:1.** `~ '^[A-Z]{3}$'` became `GLOB '[A-Z][A-Z][A-Z]'`,
  `cardinality` became `json_array_length`, and `char_length(btrim())` became
  `length(trim())`.
- **NULLS NOT DISTINCT.** The `shifts_{recurring,extra,cover,parent_cover}_window_unique`
  indexes and `time_entries_one_cancellation_paid_per_span` index the nullable
  column as `quote(col)`. NULL becomes the text `'NULL'`, so two open shifts
  with the same window still collide. `expenses_one_pending_claim_idx` uses
  `quote(amount_minor)` and `quote(miles)` in place of the old `COALESCE(…, -1)`.
- **Ranges.** No table had a range *column*. Every `tstzrange` was built inside
  an EXCLUDE constraint from the existing pairs (`starts_at`/`ends_at` and
  `clock_in_at`/`clock_out_at`), so no columns were renamed. Overlap means
  half-open `[start, end)`: `a.start < b.end AND b.start < a.end`.
- **`v_busy_blocks` is not created.** Its definition is in a comment at the bottom
  of `schema/availability.ts`; rebuild it as a repository query. It was
  `security_invoker`, so filter by `user_id` yourself.

## 2. Errors: `mapDbError(err)` replaces SQLSTATE matching

`mapDbError(err) → { kind: 'unique'|'foreign_key'|'check'|'overlap', constraint? } | null`.
It accepts raw bun:sqlite errors, D1 errors and `DrizzleQueryError`, walking
the `cause` chain. Drizzle wraps every driver error, so never test
`err.message` directly.

| Old check | New check |
|---|---|
| `error.code === '23505'` | `mapDbError(e)?.kind === 'unique'` |
| `23505` and index name X | `mapDbError(e)?.constraint === X`. The name is recovered for expression indexes (SQLite names them) and for plain-column uniques (mapped back from the column list via the Drizzle schema). Tested for `terms_proposals_open_unique_idx`, `shifts_extra_window_unique`, `shift_events_keyed_unique_idx` and `push_reminder_log_pkey`. |
| `error.code === '23P01'` and `shifts_carer_window_excl` | `kind === 'overlap' && constraint === 'shifts_carer_window_excl'` (also `time_entries_no_clock_overlap_per_carer` / `time_entries_no_overlap_per_household`) |
| check_violation (draft household) | `kind === 'check'`, constraint `refuse_draft_<table>` |
| `P0001 TIMESHEET_HAS_PAYMENTS` | message contains `TIMESHEET_HAS_PAYMENTS` (mapDbError returns null for it, so match the message) |

Callers to port:
- **Matching by name:** `termsProposalRepository`, `scheduleShiftRepository`,
  `shiftEventRepository`, `shiftRepository` and `shift/utils/carerWindowOverlap.ts`.
- **Bare 23505:** `reminderLogRepository`, `expenseRepository`,
  `reimbursementSettlementRepository`, `payArrangementAckRepository` and
  `ptoLedgerRepository`.
- **23P01:** `shiftChangeRequestRepository`.

**Batch inserts:** Postgres failed the whole statement on one duplicate. A D1
`batch` is likewise all-or-nothing. `shiftEventRepository.insertMany`'s
"batch, then row by row on a keyed duplicate" fallback still works. A simpler
alternative is `INSERT … ON CONFLICT DO NOTHING`, but a partial expression
index cannot be the conflict target, so use a bare `ON CONFLICT DO NOTHING`.
That skips duplicates on *any* unique constraint, so only use it where that is
acceptable.

## 3. Triggers ported to SQLite (`migrations/0001_triggers.sql`, 45)

| Trigger(s) | Source | Behaviour in D1 |
|---|---|---|
| `shifts_carer_window_excl_{insert,update}` | 104 | Rejects a live shift (`carer_id` not null, status not cancelled/declined) overlapping another live shift of the same carer **in the same household**. The update variant fires on household_id, carer_id, starts_at, ends_at and status, so un-cancelling into an overlap is refused. |
| `time_entries_no_clock_overlap_per_carer_{insert,update}` | 055→069 | Same carer, **any household**. Exempt: `kind='cancellation_paid'`, `status='voided'`, rows missing either clock. |
| `time_entries_no_overlap_per_household_{insert,update}` | 055→069 | Same carer and household. Cancellation pay is **included**; voided rows and rows missing a clock are exempt. |
| `refuse_draft_{child_commitments,pay_arrangements,shifts,time_entries,timesheets}` | 093 (D-36) | BEFORE INSERT. Raises `CHECK constraint failed: refuse_draft_<table>` when `households.state='draft'`. |
| `child_commitments_household_matches_child_{insert,update}` | 010/013 | **Behaviour change:** Postgres *overwrote* `household_id` with the child's household. D1 *rejects* a mismatch (`CHECK constraint failed: child_commitments_household_matches_child`), so callers must pass the child's household. `childCommitmentCommandService` already does. |
| `timesheets_refuse_reopen_when_paid` | 102 | BEFORE UPDATE OF status. When moving approved→not approved and any `payments` row exists, raises `TIMESHEET_HAS_PAYMENTS`. |
| `{expenses,pay_arrangements,pto_ledger,time_entries,timesheets}_stamp_household_member_id` | 058 | **AFTER** INSERT. Fills a NULL `household_member_id` from `household_members(household_id, user_id=carer_id)`. |
| `set_<table>_updated_at` (25 tables) | 001 et al. | AFTER UPDATE. Stamps `updated_at` to now **unless the statement set it explicitly**, which is a behaviour change: Postgres always overwrote it. `app_config` has no trigger, as before. |
| `set_timesheets_updated_at` | 100 | As above, except an update that changes only `parent_viewed_at` (a read receipt) leaves `updated_at` alone. Its column list must be kept in step with the `timesheets` table. |

**Two things to watch:**
1. **RETURNING caveat.** SQLite's `RETURNING` does not see AFTER-trigger
   writes. `insert(...).returning()` returns `household_member_id` as passed
   (NULL if omitted) and `updated_at` as written. If the response needs the
   stamped value, set `household_member_id` in the service (one lookup) or
   re-read the row.
2. **Insert-time `updated_at`.** On the five stamp tables that also stamp
   `updated_at` (expenses, time_entries, timesheets), the member-id stamp is an
   UPDATE, so `updated_at` is re-stamped to now at insert. That is harmless.

## 4. NOT ported: the service layer must do these

| Postgres object | Source | What it did | Do instead |
|---|---|---|---|
| `sync_shifts_local_date` trigger | 015 | `local_date := (starts_at AT TIME ZONE timezone)::date` on INSERT and on UPDATE OF starts_at/timezone | `local_date` is NOT NULL. Every shift insert, and every update touching starts_at or timezone, must set `local_date: shiftLocalDate(starts_at, timezone)` (`src/db/localDate.ts`). That includes the accept and parent-edit paths in §5, and the schedule horizon generator. |
| `sync_time_entries_local_date` trigger | 017 | `local_date := (coalesce(clock_in_at, clock_out_at, now()) AT TIME ZONE timezone)::date` on INSERT and on UPDATE OF clock_in_at/clock_out_at/timezone | Set `local_date: timeEntryLocalDate(row, timezone)` on every such write. That covers clock in/out, retroactive entries, cancellation-pay rows, split-session fragments and `updateEntry`. **Note:** it re-derives on *any* clock change. Clocking out after midnight leaves local_date on the clock-in day, because clock_in_at wins the coalesce. |
| `v_busy_blocks` view | 016 / 104 | Union of live shifts, non-cancelled time off and non-free busy blocks | Repository query (definition in `schema/availability.ts`) |
| `private.can_read_household`, `can_write_household`, `household_ids_for_current_user`, `is_draft_author`, `is_household_member`, `is_household_parent`, `shares_household_with` | 012/040/093… | RLS helpers | Dropped. The API was already service-role and RLS was bypassed, so the checks already live in services. |
| `private.cron_api_base_url`, `cron_job_api_key` | 007/032 | Vault lookups for pg_cron → pg_net | Dropped. Replaced by Workers `triggers.crons`. |
| `public.job_http_failures(interval)` | 105 | Counted non-2xx `net._http_response` rows since `now() - p_since` | No D1 equivalent: pg_net is gone. `jobs/jobHealthJob.ts` must drop that probe, or derive it from `job_runs` (e.g. expected runs vs rows with `status='failed'`). |
| RLS policies, grants, `auth.uid()` | all | — | Dropped |
| pg_cron schedules | 026…105 | — | Phase 3, `wrangler.jsonc` crons |

## 5. The 11 RPCs

### How to replace `FOR UPDATE` on D1

D1 has no interactive transactions or row locks. Writes are serialised per
database, and **one SQL statement is atomic**. A `db.batch([...])` is
all-or-nothing, but a statement inside it cannot branch on an earlier result.
Another request **can** interleave between your read and your batch. So the
pattern is:

1. **Read** what you need, to build the statements and to classify failures.
2. **Write with guards.** Every write repeats the precondition in its own
   `WHERE` clause, and money and single-use inserts are written as
   `INSERT … SELECT … WHERE <precondition>`. The check and the write then form
   one atomic statement, and that statement is the lock replacement.
3. **Check affected rows** (`meta.changes`, or `returning()` length). When it is
   0, re-read and return the outcome the RPC would have returned.
4. **Batch** the guarded "primary" write together with its dependent writes
   (events, sibling updates). Make every dependent write's `WHERE` gate on the
   primary write having happened, for example `WHERE EXISTS (SELECT 1 FROM
   shift_change_requests WHERE id = ? AND status = 'accepted' AND responded_by = ?)`.
   A lost race then makes the whole batch a no-op instead of half-applying.

Every outcome string below is part of the wire and service contract. Keep the
exact keys.

---

### 5.1 `record_timesheet_payment`
Caller: `domains/pay/repositories/paymentRepository.ts`.
Inputs: `p_timesheet_id`, `p_amount_minor int`, `p_paid_at date`,
`p_method_note`, `p_recorded_by`, `p_idempotency_key text|null`.
Tables: `timesheets` (read, the anchor) and `payments` (read, then insert).
Postgres locked the `timesheets` row.

Steps, in order:
1. **Idempotency before any payable check.** If a key is given and a `payments`
   row with that `idempotency_key` exists, return
   `{outcome:'recorded', payment}`, even if the week was reopened since.
2. If the timesheet is missing, `status <> 'approved'`, `gross_minor` is null or
   `currency` is null, return `{outcome:'not_payable', status}`.
3. `already = coalesce(sum(amount_minor),0)` over **all** payments for the
   week, **signed and with no kind filter**, so corrections (negative) count.
   If `already + amount > gross_minor`, return
   `{outcome:'exceeds_gross', already_paid_minor, gross_minor}`. Refuse; never
   clamp.
4. Insert into `payments`, taking `timesheet_id`, `household_id`, `carer_id` and
   `currency` **from the timesheet row, never from arguments**, with
   `kind='payment'`, `amount_minor`, `paid_at`, `method_note`, `recorded_by` and
   `idempotency_key`. Return `{outcome:'recorded', payment}`.

D1 guard: one statement,
`INSERT INTO payments (...) SELECT t.id, t.household_id, t.carer_id, ?, t.currency, ?, 'payment', ?, ?, ? FROM timesheets t WHERE t.id = ? AND t.status = 'approved' AND t.gross_minor IS NOT NULL AND t.currency IS NOT NULL AND (SELECT coalesce(sum(amount_minor),0) FROM payments WHERE timesheet_id = t.id) + ? <= t.gross_minor RETURNING *`.
- 0 rows: re-read and classify (`not_payable` or `exceeds_gross`, with the figures).
- A unique error on `payments_idempotency_key_uidx` (constraint name via
  mapDbError) is the concurrent-retry case: select by key and return
  `recorded`.
- Concurrency tests to port: two parallel payments whose sum exceeds gross
  produce exactly one success; a payment racing a reopen.

### 5.2 `record_payment_correction`
Caller: `paymentRepository.ts`.
Inputs: `p_timesheet_id`, `p_corrects_payment_id`, `p_amount_minor` (must be
negative), `p_paid_at`, `p_reason`, `p_recorded_by`.
Tables: `timesheets` (anchor, locked) and `payments` (the original, locked;
the sum; the insert).

Steps:
1. No timesheet: return `{outcome:'not_correctable', reason:'week_missing'}`.
   There is **deliberately no `approved` re-check**; a reopened week is still
   correctable.
2. Original = payments `WHERE id = p_corrects_payment_id AND timesheet_id = p_timesheet_id`.
   Missing: `{outcome:'not_correctable', reason:'payment_missing'}`.
3. `original.kind <> 'payment'`: `{outcome:'not_correctable', reason:'not_a_payment'}`.
   There is one level of correction, no chains.
4. `remaining = original.amount_minor + coalesce(sum(amount_minor),0)` over the
   rows `WHERE corrects_payment_id = original.id`. If `amount >= 0` or
   `amount < -remaining`, return
   `{outcome:'exceeds_original', original_amount_minor, remaining_minor}`.
5. Insert into `payments`, taking timesheet_id, household_id, carer_id and
   currency from the **original**, with amount, paid_at, `kind='correction'`,
   `corrects_payment_id`, `correction_reason=p_reason` and recorded_by. Return
   `{outcome:'recorded', correction}`.

D1 guard: `INSERT … SELECT … FROM payments o WHERE o.id = ? AND o.timesheet_id = ? AND o.kind = 'payment' AND ? < 0 AND ? >= -(o.amount_minor + (SELECT coalesce(sum(amount_minor),0) FROM payments WHERE corrects_payment_id = o.id)) RETURNING *`.
On 0 rows, re-read to pick the reason. The CHECK `payments_kind_shape_chk`
backs up the shape.

### 5.3 `roll_up_timesheet_hours`
Caller: `domains/timesheet/repositories/timesheetRepository.ts`.
Inputs: `p_timesheet_id`, `p_total_minutes`.
Tables: `timesheets` (locked, updated) and `payments` (existence check).
Returns the updated timesheet row (SETOF; empty if the timesheet is missing).

One UPDATE. `paid = EXISTS(payments WHERE timesheet_id = id)`, of any kind,
since a fully reversed week still counts as paid. In every case set
`total_minutes = p_total_minutes`. Then:
- **paid:** keep status, approved_by, approved_at, gross_minor, currency,
  earnings, earnings_computed_at and previous_approval. Set
  `hours_changed_after_payment_at = now()`.
- **not paid:** `status = 'submitted'`; null approved_by, approved_at,
  gross_minor, currency, earnings and earnings_computed_at; set
  `hours_changed_after_payment_at = NULL`. `previous_approval` becomes
  `json_object('approved_at', approved_at, 'approved_by', approved_by, 'gross_minor', gross_minor, 'currency', currency, 'worked_minutes', CAST(json_extract(earnings,'$.worked_minutes') AS INTEGER))`
  **if the OLD status was 'approved'**; otherwise it keeps its old value. All
  references are to the OLD row, which SQLite's `SET` also reads.

D1: write it as a single `UPDATE … SET col = CASE WHEN EXISTS(SELECT 1 FROM payments WHERE timesheet_id = timesheets.id) THEN … ELSE … END … WHERE id = ? RETURNING *`.
One statement is atomic, so no extra guard is needed. Watch the interaction
with `timesheets_refuse_reopen_when_paid`: the unpaid branch moves approved to
submitted, and the trigger only fires when payments exist, which is exactly
the paid branch where status is kept. The two are consistent.

### 5.4 `review_pending_expense`
Caller: `domains/pay/repositories/expenseRepository.ts`.
Inputs: `p_expense_id`, `p_household_id`, `p_status` (approved/rejected),
`p_reviewed_by`, `p_reviewed_at`, `p_review_note`, `p_amount_minor int|null`
(only mileage approvals compute one), `p_carer_id`, `p_week_start`.
Tables: `timesheets` (locked when week and carer are given; updated) and
`expenses` (updated).

Steps:
1. If `p_week_start` and `p_carer_id` are both non-null, find the timesheet
   `(household_id, carer_id, week_start)`. If it exists and
   `status = 'approved'`, return
   `{outcome:'week_locked', week_start, timesheet_status}`.
2. `UPDATE expenses SET status, reviewed_by, reviewed_at, review_note, amount_minor = coalesce(p_amount_minor, amount_minor) WHERE id = ? AND household_id = ? AND status = 'pending' RETURNING *`.
   0 rows: `{outcome:'not_pending'}`.
3. If the timesheet existed, `UPDATE timesheets SET updated_at = now()`. This
   bumps the version token so an in-flight approve loses its `updated_at` CAS
   and recomputes. Under the D1 trigger, an explicit `updated_at` is kept, so
   write the new `toISOString()` value directly.
4. Return `{outcome:'reviewed', expense}`.

D1 guard: add the week lock to the expense UPDATE itself:
`… AND NOT EXISTS (SELECT 1 FROM timesheets WHERE household_id = ? AND carer_id = ? AND week_start = ? AND status = 'approved')`.
Batch it with the timesheet bump, gated on
`EXISTS (SELECT 1 FROM expenses WHERE id = ? AND status = ? AND reviewed_at = ?)`.
On 0 rows, re-read to choose `week_locked` or `not_pending`.

### 5.5 `apply_pto_correction`
Caller: `domains/pay/repositories/ptoLedgerRepository.ts`.
Inputs: `p_household_id`, `p_time_off_id`,
`p_expected jsonb {"YYYY-MM-DD": positive_paid_minutes}`,
`p_rows jsonb [{carer_id, kind, minutes, effective_date, carer_display_name, created_by, note}]`,
`p_require_confirmed bool`.
Tables: `carer_time_off` (locked, read) and `pto_ledger` (aggregate read,
inserts).

Steps:
1. Time off missing: `{outcome:'time_off_not_found'}`.
2. `p_require_confirmed` and `status <> 'confirmed'`:
   `{outcome:'not_confirmed', current_status}`.
3. `leave_kind = carer_time_off.kind`, taken from the row and never from
   `p_rows`.
4. `actual = { effective_date: -sum(minutes) }` grouped by effective_date over
   `pto_ledger WHERE household_id = ? AND time_off_id = ?`. Usage is stored
   negative. If `actual != (p_expected ?? {})`, compared as a JSON object
   (key/value equality, order-free), return `{outcome:'stale', current: actual}`.
5. Insert every row of `p_rows`, with `household_id`, `time_off_id` and
   `leave_kind` stamped from the arguments and the row. Return
   `{outcome:'applied', rows}`, sorted by effective_date.

D1 guard: this is a compare-and-set on an aggregate. Gate every insert on
the ledger fingerprint the state should have **just before that row**:
- In JS, compute `fp_0 = canonical(p_expected)` and, for each row k,
  `fp_k = fp_{k-1}` with row k's minutes applied. Use canonical JSON: keys
  sorted, compact, values are the positive paid minutes per day.
- Write row k as `INSERT INTO pto_ledger (...) SELECT ... WHERE (SELECT coalesce(json_group_object(d, -m), '{}') FROM (SELECT effective_date d, sum(minutes) m FROM pto_ledger WHERE household_id = ? AND time_off_id = ? GROUP BY effective_date ORDER BY effective_date)) = fp_{k-1} AND EXISTS (SELECT 1 FROM carer_time_off WHERE id = ? [AND status = 'confirmed'])`.
  Bind `leave_kind` as `(SELECT kind FROM carer_time_off WHERE id = ?)`.
- Send all rows in one batch and require total changes = `p_rows.length`.

A concurrent writer makes row 1's guard fail, and every later row then fails
too because the state never reached `fp_{k-1}`. Nothing lands: re-read and
return `stale` with the current map. Verify that `json_group_object`'s output
matches your JS canonical form, ordering included, in a unit test. The partial
unique `pto_ledger_one_usage_per_time_off_day_idx` still backs up double usage.

### 5.6 `apply_parent_shift_edit`
Caller: `domains/shift/repositories/shiftRepository.ts`.
Inputs: `p_shift_id`, `p_actor_id`, `p_starts_at`, `p_ends_at`, `p_note`, the
flags `p_set_starts_at`, `p_set_ends_at` and `p_set_note`, and `p_origin`.
Tables: `shifts` (locked, updated) and `shift_events` (insert).
Returns the updated shift row.

Steps:
1. Shift missing: **raise** `shift not found: <id>`. This is an exception, not
   an outcome.
2. `UPDATE shifts`:
   - Set `starts_at`, `ends_at` and `note` only where their flag is set;
     `origin = p_origin`; `sequence = old.sequence + 1`.
   - `status = 'pending'` **iff** the old status is `confirmed` AND (a set
     starts_at differs from the old one OR a set ends_at differs); otherwise
     keep it. The diff is by value (071), so an identical resend, or a
     note-only edit, does not demote.
   - **D1 addition:** if starts_at changed, also set
     `local_date = shiftLocalDate(new starts_at, timezone)`.
3. Insert a `shift_events` row: household_id, shift_id, `local_date` = the
   **new** row's, actor_id, `event_type='shift_updated'`, and
   `payload = {before:{starts_at,ends_at,note,sequence,origin,status}, after:{same keys from the new row}, actor_id}`.

D1 guard: read the shift (that gives `before`), then batch:
(a) `UPDATE shifts … WHERE id = ? AND sequence = <read sequence>`, where
`sequence` is the version CAS; (b) the event insert as
`INSERT … SELECT … WHERE EXISTS (SELECT 1 FROM shifts WHERE id = ? AND sequence = <read+1>)`.
On 0 changes, retry the read-then-batch (bounded, say 3 times) or surface a
conflict. Overlap and window-unique errors from (a) propagate as before,
via mapDbError `overlap` / `unique`.

### 5.7 `open_shift_change_request`
Caller: `domains/shift/repositories/shiftChangeRequestRepository.ts`.
Inputs: `p_shift_id`, `p_requested_by`,
`p_kind` (time_change|cancel|counter_offer|split|handover), `p_proposed_starts_at`,
`p_proposed_ends_at`, `p_message`.
Tables: `shifts` (locked, read), `time_entries` (existence),
`shift_change_requests` (supersede update and insert) and `shift_events`
(inserts).

Steps:
1. Shift missing: `{outcome:'shift_not_found'}`.
2. Shift status is `completed` or `cancelled`:
   `{outcome:'shift_immutable', shift_id, shift_status, blocked_by:'status'}`.
3. Any `time_entries.shift_id = shift.id`:
   `{outcome:'shift_immutable', shift_id, shift_status, blocked_by:'has_time_entries'}`.
4. Supersede: `UPDATE shift_change_requests SET status='superseded' WHERE shift_id = ? AND status = 'pending'`,
   remembering the closed rows. There is at most one open request per shift.
5. Insert the new request (`status='pending'`).
6. Insert a `shift_events` row: `change_request_created` with actor
   requested_by, local_date = shift's, and
   `payload {change_request_id, kind, message}`.
7. For each superseded sibling, insert `change_request_superseded` with actor
   requested_by and `payload {change_request_id: sibling.id, kind: sibling.kind, superseded_by: new.id}`.
8. Return `{outcome:'opened', change_request, superseded:[rows]}`.

D1: pre-generate the new id in JS. Read the pending siblings first, then
batch in this order:
1. The supersede UPDATE, guarded `AND id IN (<read sibling ids>)`.
2. The INSERT of the new request, as `INSERT … SELECT … WHERE NOT EXISTS (SELECT 1 FROM shift_change_requests WHERE shift_id=? AND status='pending') AND EXISTS (SELECT 1 FROM shifts WHERE id=? AND status NOT IN ('completed','cancelled')) AND NOT EXISTS (SELECT 1 FROM time_entries WHERE shift_id=?)`.
3. The events, gated on `EXISTS (SELECT 1 FROM shift_change_requests WHERE id = <new id>)`.

If the new request didn't land, a sibling appeared or the shift changed:
re-read and return the matching outcome or retry. **Recommended:** add a
partial unique index `ON shift_change_requests(shift_id) WHERE status='pending'`
in a follow-up migration. That was the original serialisation intent
(024/028); it isn't in the Postgres schema, so it is not in the baseline
either.

### 5.8 `accept_shift_change_request`
Caller: `shiftChangeRequestRepository.ts`.
Inputs:
- `p_change_request_id`, `p_responded_by`, `p_response_message`;
- the cancel branch: `p_set_cancel`, `p_cancelled_at`, `p_cancelled_by`,
  `p_cancellation_paid`, `p_cancellation_message`;
- the time branch: `p_set_times`, `p_starts_at`, `p_ends_at`;
- `p_origin`, `p_is_short_notice`;
- `p_events jsonb [{household_id, shift_id, actor_id|'' , event_type, payload}]`
  (caller-built, e.g. `shift_cancelled`/`shift_updated`).

Tables: `shift_change_requests` (read, accept update, supersede update),
`shifts` (locked, updated), `time_entries` (existence) and `shift_events`
(inserts).

Steps:
1. Request missing: `{outcome:'not_pending', current_status:'missing'}`.
2. Shift missing: `{outcome:'shift_not_found', shift_id}`.
3. Shift `completed`/`cancelled`:
   `{outcome:'shift_immutable', shift_id, shift_status, blocked_by:'status'}`.
   Shift has time entries: same, with `blocked_by:'has_time_entries'`.
4. `UPDATE shift_change_requests SET status='accepted', responded_by, responded_at=now, response_message WHERE id=? AND status='pending'`.
   0 rows: `{outcome:'not_pending', current_status: <re-read status or 'missing'>}`.
5. Supersede the other pending requests on the shift (`id <> accepted`).
6. Then, depending on the branch:
   - `p_set_cancel`: `UPDATE shifts SET status='cancelled', cancelled_at, cancelled_by, cancellation_paid, cancellation_message, is_short_notice, origin`.
     The sequence is **not** bumped.
   - `p_set_times`: `UPDATE shifts SET starts_at, ends_at, origin, is_short_notice, sequence = old+1`.
     **D1 addition:** set `local_date = shiftLocalDate(p_starts_at, timezone)`.
   - Neither flag: no shift write.
7. Insert each `p_events` element. `local_date` is the shift's **post-update**
   local_date; an empty actor_id becomes NULL; payload defaults to `{}`.
8. For each superseded sibling: `change_request_superseded`, actor responded_by,
   `payload {change_request_id, kind, superseded_by: p_change_request_id}`.
9. Return `{outcome:'accepted', change_request, shift, superseded:[...]}`.

Overlap: a time change can hit `shifts_carer_window_excl`.
`shiftChangeRequestRepository` used to catch 23P01; in D1, mapDbError gives
`kind:'overlap'`. Because it is in a batch, the accept is rolled back with it,
just as the Postgres transaction was.

D1: batch these, in order:
1. The accept UPDATE (CAS on `status='pending'`), also guarded with
   `AND EXISTS (SELECT 1 FROM shifts WHERE id=? AND status NOT IN ('completed','cancelled')) AND NOT EXISTS (SELECT 1 FROM time_entries WHERE shift_id=?)`.
2. The supersede, guarded `AND EXISTS (accepted row by id with responded_by = ?)`.
3. The shift update, with the same gate plus `AND sequence = <read>`.
4. The events, with the same gate.

Then check the accept's changes; on 0, re-read and classify.

### 5.9 `redeem_draft_household_invite`
Caller: `domains/household/repositories/householdInviteRepository.ts`.
Inputs: `p_code`, `p_redeemer_id`, `p_target_household_id uuid|null`,
`p_week_starts_on smallint|null`.
Tables: `household_invites` (locked, claimed), `households` (read the draft;
insert or lock the target), `household_members` (author lookup, redeemer
permission, existing check, inserts), `children` (copy) and `terms_proposals`
(read the open draft proposal, insert a copy).

Steps:
1. Invite by `code = upper(trim(p_code))`. If it is missing, not `pending`, or
   `expires_at < now`, return `{outcome:'invite_unavailable'}`. All of these
   collapse into one outcome on purpose, to hide whether the code exists.
2. Draft = `households` by `invite.household_id`. If it is missing or
   `state <> 'draft'`, return `{outcome:'not_a_draft_invite'}`; the caller
   then falls through to the normal redeem.
3. Author = `household_members WHERE household_id=draft.id AND user_id=draft.created_by AND role='nanny' AND status='active'`.
   Missing: `{outcome:'draft_has_no_author'}`. `nanny_id = author.user_id`.
4. `nanny_id = p_redeemer_id`: `{outcome:'self_redemption'}`.
5. Pick the target:
   - **Instantiate** (`p_target_household_id` null):
     - Insert `households (name = coalesce(draft.name,'Our household'), timezone, currency, jurisdiction, week_starts_on = coalesce(p_week_starts_on, draft.week_starts_on), state='live', created_by = redeemer)`.
       **Note:** `country` is not copied, so it takes the default `'US'`. That
       matches Postgres, but check whether it is intended.
     - Insert the owner membership `(redeemer, role 'owner', can_edit true, status 'active')`.
     - Copy the draft's **non-archived** children (name, birth_date, colour,
       avatar_initial, routine_notes) into the new household.
     - `instantiated = true`.
   - **Absorb:**
     - The target is `households WHERE id = p_target AND state = 'live'`
       (locked); if missing, `{outcome:'target_not_permitted'}`.
     - The redeemer must be an `active` `owner`/`parent` of the target, else
       `{outcome:'target_not_permitted'}`.
     - `p_week_starts_on` is ignored on this branch.
6. If **any** membership exists for `(target, nanny_id)`, in any status, return
   `{outcome:'already_member', household_id, status}` before claiming the code.
7. Insert the nanny membership: `role 'nanny'`, `can_edit false`,
   `status = instantiated ? 'active' : 'candidate'` (D-49).
8. Latest draft proposal = `terms_proposals WHERE household_id=draft.id AND carer_id=nanny_id AND status='proposed' ORDER BY created_at DESC LIMIT 1`.
   If found, insert a copy into the target: `proposed_by = nanny`,
   `direction 'carer'`, `status 'proposed'`, terms, note,
   `from_invite_id = invite.id`, carer_display_name.
   A unique violation (`terms_proposals_open_unique_idx`) rolls back
   **everything** and returns `{outcome:'proposal_already_open', household_id}`.
   The draft's own proposal is never modified.
9. Claim: `UPDATE household_invites SET status='accepted', accepted_by=redeemer, accepted_at=now WHERE id=? AND status='pending'`.
   0 rows: `{outcome:'invite_unavailable'}`.
10. Return `{outcome:'redeemed', instantiated, household_id, draft_household_id, carer_id, membership, proposal|null}`.

D1: do steps 1–6 as reads, pre-generate every id in JS, then send **one
batch** with the invite claim **first**:
`UPDATE household_invites … WHERE id=? AND status='pending' AND expires_at >= now`.
Every later statement is gated on
`EXISTS (SELECT 1 FROM household_invites WHERE id=? AND status='accepted' AND accepted_by=? AND accepted_at=<the value you just wrote>)`.

A unique violation anywhere aborts the whole batch, which restores the claim,
and is classified as follows:
- on `terms_proposals_open_unique_idx`: `proposal_already_open`;
- on `household_members_user_household_idx`: re-read and return `already_member`.

On absorption, also gate the membership insert on the redeemer's
active parent/owner row in the target. If the claim's changes are 0, return
`invite_unavailable`.

Draft refusal: no D-36 trigger targets `household_members`, `children` or
`terms_proposals`, so the new live household accepts them, as it did in
Postgres.

### 5.10 `run_integrity_checks`
Caller: `jobs/integrityCheckJob.ts`. It is read-only and returns
`(check_name, entity_id, details jsonb)` rows.

All the checks share one CTE, `entry_minutes`: time entries with both clocks
and (carer_id or household_member_id) set. Its fields are:
- `carer_key = coalesce(carer_id, household_member_id)`;
- `week_start` = the ISO **Monday** of `local_date`. This is Postgres
  `date_trunc('week')` and ignores `households.week_starts_on`. That looks
  like a latent bug for Sunday-start households; keep it or fix it
  deliberately;
- `minutes = max(0, round((out-in)/60s) - break_minutes)`, except that
  cancellation_paid rows use `coalesce(scheduled_minutes, that)`.

The checks:
- `timesheet_total_mismatch`: for a timesheet with a carer_key, stored
  `total_minutes` ≠ the sum over `(household, carer_key, week_start)`.
  Details: household_id, week_start, stored_minutes, derived_minutes.
- `approved_snapshot_mismatch`: an approved timesheet with gross but no
  earnings, or `earnings.status='ok'` with no gross.
- `pto_net_negative`: `sum(pto_ledger.minutes) > 0` per (household,
  time_off_id). entity = time_off_id.
- `expense_pending_dup`: more than one pending expense with a carer, grouped by
  the `expenses_one_pending_claim_idx` tuple. entity = the smallest id.
- `cancellation_unsettled`: a shift that is cancelled with
  `cancellation_paid`, has a carer, has `coalesce(cancelled_at, updated_at) < now - 2h`,
  and has no `time_entries` with kind cancellation_paid for it.
- `entry_overlap`: pairs of entries for the same carer (a.id < b.id) with both
  clocks and overlapping `[in,out)`, where the households are the same OR
  neither is cancellation_paid. `rule` is per_household or per_carer.
  **Voided rows are NOT excluded here**, unlike the triggers.
- `stuck_runner`: `status='running'`, no clock_out, `clock_in_at < now - 20h`.
- `orphan_week`: entry_minutes groups with no matching timesheet. Details:
  entry_count, derived_minutes. entity = the smallest entry id.
- `household_ownerless`: a household whose active members include no
  owner/parent. Details: active_member_count, roles.

D1: port it as a set of Drizzle or raw-SQL queries unioned in JS. Instant
math uses `(julianday(b) - julianday(a)) * 1440`. Compute the week in JS or
with `date(local_date, 'weekday 1', '-7 days')`; it must match the Monday
semantics.

### 5.11 `job_http_failures`
Caller: `jobs/jobHealthJob.ts`. It counted pg_net failures. It **cannot be
ported**; see §4.

## 6. Other notes for Phase 2

- `household_member_id` on payroll tables is stamped by trigger, but
  `RETURNING` won't show it (§3). The 033 payroll-preservation behaviour
  (`carer_id` set to null on profile delete, rows kept) is the FK `SET NULL`,
  and it is unchanged.
- **Concurrency test ports, in priority order:** payment versus
  over-gross (5.1), correction versus over-reversal (5.2), redeem twice (5.9),
  accept versus open on the same shift (5.7/5.8), PTO correction stale (5.5).
- **Migrations:** `drizzle-kit generate` writes into `migrations/`, which is also
  wrangler's `migrations_dir`. `0001_triggers.sql` was created with
  `generate --custom`, so it is in drizzle's journal and future generates
  number from 0002. Separate statements with `--> statement-breakpoint`.
- **Better Auth schema** (`schema/auth.ts`) matches better-auth 1.7's
  `getAuthTables` for email/password plus the expo plugin, which adds no
  tables. If you enable `rateLimit.storage: 'database'`, add the `rateLimit`
  table.
- **Better Auth's zod range is load-bearing.** The root `overrides.zod` pin
  must satisfy better-auth's own `zod` range (1.7.27 requires `^4.5.4`).
  Below that, its IP check calls a missing `z.validate`, and every auth
  request that carries an IP header returns 500. tsc does not catch this, and
  unit tests only catch it if a test sends the header
  (`tests/unit/auth/rateLimitIp.test.ts` does). The rate-limit key comes from
  `cf-connecting-ip` (`advanced.ipAddress`), never `x-forwarded-for`, which
  the client controls.
