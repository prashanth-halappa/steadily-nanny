# AGENCY-ROADMAP.md

How Steadily Nanny gets from "one family and their independently-sourced nanny"
to "a nanny agency running its caregivers and its client families" — without
building two products, and without stalling the thing that works today.

Written 2026-08-04 from four parallel research passes: agency operations
(US/UK), the agency-software competitive landscape, caregiver/family pain
points, and a full audit of this repo's own data model. Prices, percentages and
statutory figures below are **reported from public sources at time of writing**
and should be re-checked before they end up in a pricing page or a contract
template.

---

## 1. The strategic finding, in one paragraph

Every purpose-built nanny agency product on the market — Enginehire, NannyLogic,
Vars, and the household-staffing arms of Aaniie — is optimised for the **front
half** of the agency lifecycle: sourcing, ATS, matching, contracts, invoicing
setup. That's where the placement fee is earned, so that's where the software
went. Scheduling and timekeeping, where they exist at all, are a calendar widget
bolted onto a CRM. Meanwhile the payroll vendors (HomePay, Poppins, GTM,
NannyPay, Nannytax) are excellent single-purpose tax utilities with zero
scheduling, zero caregiver app, and zero placement tooling. And the shift tools
that *do* have a pleasant mobile timeclock — Deputy, Connecteam, When I Work,
Homebase — model "one employer, many staff, one worksite," which is the exact
inverse of "one caregiver, one household employer, one changing home address,
for years."

**Steadily is already sitting in the seam none of them occupy.** Do not build an
ATS. Build the post-placement operating layer, which is the half of the market
that is genuinely underserved and the half you have already built.

### Why that seam is real, not wishful

The industry's own trade association says so. APNA's guidance to member
agencies — *"Going Beyond the Placement"* — frames staying involved after the
hire as an **unmet opportunity**, not current practice. In the dominant US
permanent-placement model the family is the legal employer from day one, so the
agency's involvement effectively ends at placement plus a **90-day replacement
guarantee** (the de facto industry standard for placements of a year or more).
Agencies charge **15–20% of first-year gross salary**, often with a **$3,000–
$5,000 minimum** and a **$250–$500 non-refundable registration fee** — and then
hand scheduling, timekeeping, and payroll to the family and walk away.

So there are two distinct agency models, and they want opposite things from you:

| Model | Who employs the nanny | What the agency retains | What they'd buy from you |
|---|---|---|---|
| **Permanent placement** (most US agencies) | The family | Nothing after the guarantee window | A retention/visibility product they give the family — reduces guarantee-period churn, creates an ongoing touchpoint, justifies a subscription after a one-time fee |
| **Temp / on-call / backup care** | The agency (employer of record) | Scheduling, timekeeping, payroll, invoicing, sick cover dispatch | The whole operating system. Bill rate vs. pay rate is their margin |

The temp/staffing model is the one that needs everything you'd build. The
permanent-placement model is the larger market and needs far less — which makes
it the *cheaper* wedge, because most of what it wants is what your independent
use case wants too.

**The pain agencies actually report** (from agency blogs, industry roundups, and
APNA material): double-bookings because a nanny accepted by text with one
coordinator while another booked her in a spreadsheet; availability that "lives
in someone's head"; hours typed once for the family invoice and again for
caregiver pay; and a scale cliff where reconciling schedules → timesheets →
invoices becomes a part-time job somewhere around **20–40 concurrent
placements**. Every one of those is a single-source-of-truth problem, and three
of the four are things this app already half-solves.

---

## 2. What you already have (and why it's worth more than it looks)

An honest inventory, because the roadmap below depends on not rebuilding it:

- **Membership-derived access, not owner-derived.** `household_members` with
  roles `owner / parent / nanny / helper`, enforced by SECURITY DEFINER helpers
  `private.is_household_member` / `is_household_parent` /
  `shares_household_with` (`supabase/migrations/009_households.sql`). The
  template's `auth.uid() = owner_id` model was already discarded as too narrow.
- **A carer already belongs to N households.** This is the single most valuable
  thing you have. `carer_availability`, `carer_time_off`, `external_busy_blocks`
  and `v_busy_blocks` are all keyed to the **person**, never the household
  (`011_availability.sql`, `016_calendar_seams.sql`). Multi-family caregivers are
  not a future migration — they're the current model, with a
  `HouseholdSwitcher` already shipping.
- **Cross-family anonymity as a structural guarantee**, not a caller
  remembering to strip fields: `v_busy_blocks` exposes only
  `user_id / starts_at / ends_at / kind`, verified live against LEAKCANARY
  fixtures.
- **DST-correct recurrence.** Patterns store nominal local wall-clock time plus
  an IANA zone; a "Thursdays 08:00" pattern survives the GMT→BST transition as
  08:00 local with unchanged duration. This is the piece most competitors get
  wrong and it is expensive to retrofit.
- **A real shift lifecycle**: propose → accept → counter → short-notice change →
  cancel, with `cancellation_paid_within_hours` policy, an append-only
  `shift_events` day thread, and a co-parent approval gate
  (`approvalGateService`) that other domains route mutations through.
- **Clock in/out → weekly timesheet → approve/query**, with `scheduled_minutes`
  frozen at clock-out so a later shift edit can't rewrite what someone was owed.
- Time off, household closures, per-child fixed commitments, coverage-gap
  detection, handoff notes, four calendar visualisations, notification
  preferences with quiet hours.

### The one gap that dominates everything

**The app tracks minutes and never tracks money.** There is no pay rate, no
currency, no gross pay, no invoice, no reimbursement — `grep` for
`hourly_rate|pay_rate|currency|invoice` across `supabase/migrations`,
`packages/shared-types`, and `apps/api/src` returns nothing but an unrelated hit
in the calendar-seams migration.

That is the highest-leverage thing missing, and it is the same gap for both use
cases:

- Independent: wage disputes, guaranteed-hours arguments, PTO entitlement, and
  unreimbursed expenses are the **top-ranked complaints on both the nanny side
  and the parent side**. Your app already has the ground truth (approved
  minutes) and stops one step short of the answer everyone is arguing about.
- Agency: pay rate vs. bill rate *is* the business model. Every invoicing,
  margin, and payroll feature is downstream of it.

Build money once, correctly, and it serves your nanny next month and the agency
product next year.

---

## 3. Prioritised roadmap

Sequenced so each tier ships standalone value to **your** use case while
removing a blocker from the agency one. Effort is rough T-shirt sizing against
this codebase's conventions (shared schema → migration → repository → service →
controller → routes → mobile endpoint → hooks → screen).

Legend: **You** = value to the independent-nanny case today · **Agency** = value
to the B2B case.

### Tier 0 — Money primitives (do this first)

| # | Feature | You | Agency | Effort | Notes |
|---|---|---|---|---|---|
| 0.1 | **Pay rates** — effective-dated `pay_rates` (household, carer, rate, currency, valid_from) | High | Required | M | Integer minor units + ISO-4217 code. **Effective-dated, never mutated in place** — a rate change must not rewrite history, same discipline as frozen `scheduled_minutes`. Add a nullable `bill_rate` column *now* even though nothing reads it; it costs a column and saves a migration on live pay data later. |
| 0.2 | **Gross pay on the timesheet** — the weekly roll-up becomes a pay statement | High | Required | S | `timesheets.total_minutes` × rate, broken out by `time_entries.kind` (`worked` / `cancellation_paid` / `manual_adjustment`). The cancellation-paid concept already exists and already has no money attached — this finishes it. |
| 0.3 | **Overtime & guaranteed hours** — per-household `overtime_threshold_minutes`, `overtime_multiplier`, `guaranteed_hours_per_week` | High | Required | M | Guaranteed hours are the #2 caregiver complaint. Jurisdictional care needed: live-in nannies are federally overtime-exempt in the US, but **CA (45h), NY (44h), NJ (40h), OR (44h)** and others override that. Model it as household config, not a hardcoded 40. |
| 0.4 | **Paid time off ledger** — accrual, balance, and paid/unpaid on `carer_time_off` | High | High | M | Today `carer_time_off` has no paid/unpaid distinction and no balance. "Do we pay the nanny when *we're* on holiday" is the single most-cited family/nanny dispute. UK statutory minimum is **5.6 weeks**; US norms cluster around 2 weeks vacation + sick days + holidays. `household_closures` already exists and is exactly the trigger for this argument. |
| 0.5 | **Expenses & mileage** — a reimbursement line that lands on the pay statement | Med | Med | S | Self-contained, top-5 caregiver complaint, no existing equivalent in the app. Currently solved with spreadsheets and repeated follow-ups. |

**Why this tier is first:** it is the only tier that is 100% dual-use. Nothing
here is agency-specific, all of it is immediately useful to you, and every Tier
2 agency feature is downstream of it.

### Tier 1 — Trust and paperwork (dual-use, agency-mandatory)

| # | Feature | You | Agency | Effort | Notes |
|---|---|---|---|---|---|
| 1.1 | **Work agreement generation + e-signature** | High | Required | M | The absence of a written contract is named as the *root cause* of most disputes on both sides. After Tier 0 you already hold every term structurally — rate, overtime rule, guaranteed hours, PTO, cancellation policy, notice period — so this is largely rendering + signature capture, not new data. |
| 1.2 | **Payroll export / handoff** — period pay summary out to HomePay, Poppins, GTM, Nannytax | High | High | S–M | **Do not build tax filing.** It's a mature cottage industry (HomePay ~$59–75/mo, Poppins ~$49/mo, GTM ~$840–1,524/yr, Nannytax from ~£276/yr) with real liability. Integrate or export; be the system of record for *hours and pay*, not the filer. |
| 1.3 | **Documents & credential expiry** — DBS/enhanced DBS, CPR/first aid, Ofsted, driving licence, insurance, right-to-work/I-9 | Low–Med | Required | M | Marginal for you (nice to know the first-aid cert is current). Load-bearing for an agency: expiry tracking is a compliance liability, and Ofsted registration in the UK requires an enhanced DBS **under 3 months old** at application plus a Level 2 childcare qualification and first-aid certificate. |
| 1.4 | **Richer daily log** — naps, feeds, nappies, meals, mood, milestones, photos | High | Low | M | Pure independent-use-case value; agencies barely care. `handoff_notes` already has the chip mechanism and the morning/evening phase split — this is an extension, not a new domain. Benchmark is Brightwheel's real-time updates vs. Tadpoles' pickup summary. **Include it because it's what makes the family love the app**, not because it moves the agency needle. |

### Tier 2 — The agency layer (structural, do not start early)

| # | Feature | You | Agency | Effort | Notes |
|---|---|---|---|---|---|
| 2.1 | **The agency tenant** — `agencies`, `agency_members`, `households.agency_id`, `private.is_agency_*` helpers | None | Required | **L** | The big one. There is no tenant above `households` today; `households` *is* the tenant. Also requires widening `household_members.role`'s CHECK constraint (currently closed to four values) and its mirror in `packages/shared-types/src/schemas/household.schema.ts`. See §4 for how to make this cheap. |
| 2.2 | **Open shifts & multi-carer offers** | Low | Required | L | `shifts.carer_id` and `schedule_patterns.carer_id` are single nullable FKs — a shift belongs to exactly one carer. "Offer to three available nannies, first to accept wins" and "unassigned shift on the bench" have nowhere to live. Needs a `shift_offers` / assignment table. |
| 2.3 | **Substitute & backup-cover dispatch** | Med | **Killer** | M (given 2.2) | *The* reason a family pays an agency: the nanny is sick at 06:30 and someone still shows up. You are unusually close — per-person availability, time-off, and anonymised busy-blocks already exist, so "who is free at 08:00 Tuesday" is largely a query you can already write. Depends on 2.2 and on push delivery actually working (§5). |
| 2.4 | **Agency console** — cross-household dashboard: who's working where today, uncovered shifts, timesheets pending approval, expiring credentials, margin | None | Required | L | **Probably a web surface, not the Expo app.** A coordinator running 40 placements works at a desk with a wide screen. Treat "do we add a web client" as an explicit strategic decision, not an implementation detail — it is the largest hidden cost in this whole roadmap. |
| 2.5 | **Client invoicing** — bill rate × approved hours → invoice per family, plus margin reporting | None | Required | M (given Tier 0) | Directly kills the "hours typed once for the invoice and again for payroll" complaint. Cheap *only if* 0.1 shipped `bill_rate` alongside `pay_rate`. |
| 2.6 | **Agency-level policy** — approval rules, cancellation windows, overtime defaults set once and inherited by managed households | None | High | M | `approvalGateService` hardcodes a two-parent negotiation reading `households.approval_mode` — **and as of migration `072_remove_ask_other.sql` (2026-08-09) that enum is down to `either` / `owner_only`; `ask_other` was removed by product decision, so any single parent's action now applies immediately with the other parent getting an FYI push.** That makes 2.6 slightly cheaper (one fewer mode to generalise) and slightly more urgent (there is now no consent mechanism at all for an agency to hook). It has no concept of an org policy or an agency role. It's already the single choke point every mutating domain routes through, so it's the right place to extend — but it's a real change, not a config flag. |

### Tier 3 — Deliberately not building (or building last)

| Feature | Verdict |
|---|---|
| **Full ATS / placement pipeline** (job orders, candidate sourcing, pipeline stages, matching engine) | **Don't lead with this.** Crowded (Enginehire, Vars, NannyLogic, plus Bullhorn/Loxo/Crelate repurposed) and it is the half of the market that is already served. If you need it later, it's Tier 4 — or integrate. |
| **Payroll tax filing** (Schedule H, W-2, PAYE/RTI submission) | **Don't.** Partner. See 1.2. |
| **Background-check integration** (Checkr ~$29.99 basic +$15 county, Sterling, Accurate, Certn) | Only meaningful once 2.1 and an ATS exist. It's an API bolt-on when the time comes, not a differentiator. |
| **Two-sided marketplace / caregiver sourcing** | No. Different business, different liability, and Care.com/Sittercity's reputation problems are a warning, not an opening. |

---

## 4. Decisions that are cheap now and expensive later

These cost near-nothing while writing Tier 0 and get painful once there's live
pay data and paying agencies. **This is the highest-value section of this
document.**

1. **Money is integer minor units plus an ISO-4217 currency code, from the very
   first migration.** Never a float, never a bare number. You already run
   en-GB/£ with a US market in view; a currency-less schema is a rewrite.

2. **Rates are effective-dated rows, never mutated in place.** Pay history is
   legal evidence in a wage dispute — the exact thing the product exists to
   prevent. This mirrors the discipline already applied to `scheduled_minutes`
   (frozen at clock-out) and to `shift_events` (append-only).

3. **Add `bill_rate` next to `pay_rate` in 0.1 even though nothing reads it for
   a year.** A nullable column now vs. a migration over live payroll data later.

4. **Introduce one level of indirection in the RLS predicate — now.** Today
   roughly twenty tables' policies call `private.is_household_member(household_id)`
   and `private.is_household_parent(household_id)` *directly*. Wrap them:

   ```sql
   -- today: a pure pass-through, zero behaviour change
   create function private.can_read_household(hid uuid) returns boolean ...
     select private.is_household_member(hid);
   create function private.can_write_household(hid uuid) returns boolean ...
     select private.is_household_parent(hid);
   ```

   Then adding agency-staff access in 2.1 is **one function body** instead of
   editing every policy on every table. Do this as a mechanical no-op migration
   before Tier 0 adds more tables that would otherwise inherit the direct calls.
   (Mind the grant pattern from `012_fix_rls_helper_grants.sql`: revoke from
   `PUBLIC`, grant explicitly to `authenticated` — a policy expression is
   evaluated with the *caller's* privileges.)

5. **Stop treating the four roles as a closed CHECK constraint.** `owner /
   parent / nanny / helper` is hardcoded in `009_households.sql` and mirrored in
   `HOUSEHOLD_ROLES`. Agency roles (admin, coordinator, recruiter) will need to
   widen both. Plan the widening path — lookup table, or accept that the
   constraint and the const-map change together — rather than discovering it
   mid-2.1.

6. **Every new write that accepts a client-supplied foreign id needs its own
   ownership check.** Repositories run as the service role and bypass RLS
   entirely — RLS is a backstop here, not a gate. Wave 3 found three
   cross-household authorization holes of exactly this shape (D12/D13/D14).
   Money endpoints are a strictly worse place to repeat that mistake than
   scheduling ones.

7. **Name the anonymity inversion out loud.** Cross-family anonymity is a
   load-bearing *product promise* for independent families sharing a nanny — and
   it is precisely *wrong* for an agency, whose coordinators must see across all
   managed households. Do not solve that by loosening
   `private.shares_household_with`. It needs an explicit, separate
   "agency staff viewing their managed households" predicate, so the independent
   guarantee stays structurally intact and testable against the existing
   LEAKCANARY fixtures.

---

## 5. Two dependencies the agency case exposes

- **Notification delivery is not wired.** Events land in an outbox and render
  in-app only; push/email/SMS are a deliberate omission. That's survivable for
  one family who open the app anyway. It is **fatal for 2.3** — dispatching a
  substitute at 06:30 requires the phone to actually ring. Draining the outbox
  (Expo push + Resend; `RESEND_API_KEY` is already in the env schema) is a
  prerequisite for the agency product, not a polish item.

- **Web surface, or not.** 2.4 assumes a coordinator at a desk. The whole repo
  is Expo + Express with no web client. Decide this deliberately — it's the
  largest unpriced item on this page.

---

## 6. Suggested sequence

**Now → next month (pure independent value, zero agency scaffolding):**
0.1 pay rates → 0.2 gross pay on timesheet → 0.3 overtime & guaranteed hours →
0.5 expenses. Ship the RLS indirection (§4.4) as a no-op migration first, while
it's still mechanical.

**Then (still independent-facing, but now agency-legible):**
0.4 PTO ledger → 1.1 work agreement → 1.2 payroll export → 1.4 richer daily log.

At this point you have a product an agency can *see the value of* without you
having written a line of multi-tenant code — and the honest test of the thesis
is whether an agency will pay for it as a per-family retention tool. That's the
cheapest possible validation of the B2B bet.

**Only then (commit to B2B):** 1.3 credentials → 2.1 agency tenant → 2.2 open
shifts → 2.3 substitute dispatch → 2.5 invoicing → 2.4 console → 2.6 agency
policy.

The ordering inside Tier 2 matters: **2.3 is the feature agencies actually buy**,
and 2.1/2.2 exist to make it possible. Don't build the console first because
it demos well.
