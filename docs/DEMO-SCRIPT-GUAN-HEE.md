# Demo Script — Guan Hee (UC-004 Filter Pipeline & UC-005 Ranking + Crew Pairing)

**EFAR Ambulance Scheduling System** · ~6–8 minute walkthrough
Login as **admin@efar.sg** for the full demo. Keep one employee login (e.g. john.tan@efar.sg) in a second browser/incognito for the access-control moment.

---

## 0. One-line elevator pitch (memorise this)

> "My part is the **brain** of the scheduler: when a shift needs a crew, UC-004 decides **who is even allowed** to take it, and UC-005 decides **who is the best choice** — and the UI shows the working for every decision, so the admin never has to trust a black box."

---

## 1. Set the scene (30 seconds)

Say:

> "EFAR runs Medical Transport (MTS) and Emergency Ambulance (EAS) shifts every day.
> Manually rostering means checking leave, rest hours, overtime caps, certifications, and fairness for every person, for every slot — that's exactly what my two use cases automate.
> **UC-004** is a five-stage eligibility filter. **UC-005** is a six-factor weighted ranking plus a driver–attendant pairing algorithm."

*(Have the Roster View open on today's date with a generated roster.)*

---

## 2. Demo step 1 — Generate a roster (1 min)

**Do:** Roster View → **Generate Roster** (or **Regenerate**).

Say:

> "One click. For every ambulance and every shift block, the engine ran the full pipeline: it pulled every active staff member, filtered out the ineligible ones, ranked the rest, and paired a driver with an attendant. The toast tells me how many slots were crewed and whether any flags were raised."

Point at the grid:

> "Each row is an ambulance, each column a 6-hour block; a cell shows the driver and attendant. A 12-hour shift spans two columns, and if a part-timer ever lands on a 12-hour shift the cell is highlighted red as a violation warning."

---

## 3. Demo step 2 — THE core demo: click a slot, show the ranking (2–3 min)

**Do:** Click any driver or attendant cell → the **ranking modal** opens.

Say:

> "This is the heart of UC-005. Every eligible candidate is scored **0–100** on six weighted factors — you can see each factor as a bar:"

| # | Factor | Weight | What it measures | Why it matters |
|---|--------|--------|------------------|----------------|
| 1 | **Fairness** | **25%** | Inverse of late shifts (start ≥ 18:00) this month, capped at 20 | Spreads unpopular night work evenly — no one gets dumped with every late shift |
| 2 | **Rest** | **20%** | Hours since their last shift ended, normalised over 24h | More rested crew = safer crew |
| 3 | **Proximity** | **20%** | Distance from home postal code to the station (default 169608) | Closer staff respond faster and are cheaper to activate |
| 4 | **Cert fit** | **15%** | Exact-fit role scores 1.0; over-qualified scores 0.6 on MTS | Saves scarce EAS-capable drivers/paramedics for EAS work only they can do |
| 5 | **Preference** | **10%** | Early-riser vs late-shift preference matched to the slot's start time | Happier staff, fewer swap requests |
| 6 | **Continuity** | **10%** | 1.0 if they have no overlapping same-day assignment | Avoids double-booking conflicts |

> "The final score is the weighted sum × 100. Ties are broken deterministically: fewer late shifts → more rest hours → closer to station → staff ID. Deterministic means the same inputs always produce the same roster — that's important for auditability."

**Do:** Point at the top card's bars.

> "So this person is ranked #1 because — read the bars — full rest, lives close, exact certification fit. And if the admin disagrees, they can override: the **Assign to Slot** button reassigns manually, but even then the backend re-runs my UC-004 filter first, so an admin can never accidentally assign someone ineligible."

*(If there's an unfilled slot, assign someone live — the slot fills and any coverage-gap flag auto-resolves.)*

---

## 4. Demo step 3 — UC-004: why people are EXCLUDED (1–2 min)

Say:

> "Ranking only sees people who survived UC-004 — a five-stage filter that runs **in strict order**, and every candidate carries a `filter_trace` recording the outcome of each stage:"

1. **Availability / Leave** — approved leave (full or half-day) or a self-reported unavailable day = hard block.
2. **Rest hours** — less than **12 hours** since their last shift ended = hard block (handles overnight shifts correctly). Plus a **post-late-shift soft rule**: a shift starting before 12:00 straight after a late shift (start ≥ 18:00) is flagged as a `rest_violation` warning — visible in the Exceptions panel — but never blocked.
3. **Daily cap** — would exceed **12 working hours** in the day = hard block.
4. **Consecutive days** — 7+ consecutive working days is a **soft flag**, not a block: the system warns the admin but lets a human decide (staffing reality beats rigidity).
5. **Certification** — two checks: the **role hierarchy** (medics/EMTs are MTS-only; drivers/paramedics can do EAS) *and* a **real, unexpired certification row** for that service type. An expired cert = hard block.

**Live proof (the money shot):**

**Do:** Availability & Leave → set a rostered person **Unavailable** for today → go back to Roster View.

> "Watch the chain reaction: the availability change instantly raises a **coverage-gap flag** in the Exceptions panel — and if I open the ranking for their slot now, that person is gone from the candidate list, because Filter 1 removed them. From the flag I can click **Find Replacement**, and UC-005 hands me a ranked list of substitutes. Detection → explanation → resolution, end to end."

---

## 5. Demo step 4 — Crew pairing + access control (1 min)

Say (pairing — no UI needed, describe it):

> "For a two-person crew, UC-005 doesn't just pick the top driver and top attendant independently. It takes both ranked pools and finds the best **proximity-compatible** pair — two people living within 18 km of each other, so they can carpool or cover for each other. If someone set a **buddy preference** and the buddy is in the top 3 of the other pool, the pair is honoured as a soft signal — never forced. If no compatible pair exists at all, it falls back to the best combined score and raises a **proximity flag** so the admin knows."

**Do:** Show the employee login (second browser).

> "And it's role-aware: an employee sees only Roster View and their own availability/leave — they can inspect the ranking transparency, but assign buttons are admin-only, enforced on the backend, not just hidden in the UI."

---

## 6. Close (20 seconds)

> "Everything I showed is covered by **173 automated backend tests** — every filter stage, the scoring math, the tie-breakers, and the pairing algorithm — so the engine's behaviour is verified, not just demonstrated. The design principle throughout: **never a black box** — every decision shows its working."

---

## Anticipated teacher questions (prep these!)

**Q: Why is consecutive-days a soft flag but rest is a hard block?**
A: Rest under 12h is a safety violation — non-negotiable. A 7th consecutive day is a fatigue *risk* that a supervisor may accept during a staffing crunch, so the system flags it and lets a human decide. Hard rules for safety, soft rules for judgement.

**Q: How did you choose the weights (25/20/20/15/10/10)?**
A: From the requirements' priority order: fairness was the #1 stakeholder complaint (late-shift dumping), so it's heaviest; rest and proximity tie into safety and response time; preference and continuity are nice-to-haves. And they're **configurable without touching code**: each weight can be overridden with a `RANK_WEIGHT_*` env var and the set is auto-normalised to sum to 1 (invalid values fall back to the defaults) — that satisfies the UC-005 precondition that "ranking weights are configured", with tests covering the normalisation.

**Q: The rules reference says "after a late shift, the next shift shouldn't start before 12:00" — where is that?**
A: Implemented as a **soft rule** in the filter pipeline (step 2b): if a candidate's previous shift was a late shift (start ≥ 18:00) and the new slot starts before noon, they stay eligible but carry a `late_shift_rest` soft flag — same philosophy as consecutive days: hard rules for safety, soft rules for judgement. If the engine (or an admin override) assigns them anyway, a `rest_violation` warning lands in the Exceptions panel.

**Q: What happens when NOBODY passes the filters?**
A: The slot stays unfilled, and the generator raises a **critical coverage-gap flag** in the Exceptions panel instead of silently assigning someone unsafe. The admin resolves it via Find Replacement or by importing more staff. (Common real cause: expired certifications — Filter 5 is strict; there's a migration and auto-provisioning that fixes it.)
And there's an escalation path (UC-004 A2): staff marked **management** pass the same filters but are **never auto-assigned** — if they're the only ones who qualify, the flag says "**management deployment required**" and names them, so the admin deploys management deliberately, never by accident.

**Q: How do you prevent an admin from overriding into an illegal state?**
A: The assign/reassign endpoints re-run the UC-004 filter server-side before writing. A hard-blocked candidate returns HTTP 422 with the block reason. The frontend can't bypass it.

**Q: Overnight shifts (18:00–06:00)?**
A: All time math normalises past midnight — durations, rest-hours between days, and daily-cap overlap are computed on a linear minutes axis, and there are dedicated tests for it.

**Q: Is the proximity real geodata?**
A: It's a postal-district centroid approximation (Singapore postal sectors → km estimate) — good enough for ranking, no external API dependency, and the station postal / pairing radius are env-configurable (`STATION_POSTAL`, `PAIR_RADIUS_KM`).

---

## 60-second fallback (if tech fails)

Draw on the whiteboard: **20 staff → [5 filters] → 8 eligible → [6-factor score] → ranked list → [pairing] → driver + attendant**, then explain the table of weights above and the soft-flag philosophy. The narrative survives without the app.

## Pre-demo checklist

- [ ] Run `docs/migrations/2026-07-16-backfill-home-postals.sql` in the Supabase SQL Editor so staff distances actually VARY (otherwise every candidate shows the same/unknown distance and the proximity bars look flat)
- [ ] Backend + frontend running, logged in as **admin@efar.sg** (badge must say **Admin**)
- [ ] A roster generated for **today** (do it before class — don't gamble on live Wi-Fi)
- [ ] One staff member you can safely mark Unavailable (know their name in advance)
- [ ] Employee login ready in an incognito window
- [ ] `npm test` run that morning — say "173 passing" with confidence
