# Roster Desk: Smart Roster Management System

A browser-based tool for an operations manager to **plan, generate, validate and edit monthly rosters** for 30+ employees
across many brands, processes and pods. Built for the Datastraw internship assessment.

**Stack:** React + Vite + TypeScript + Zustand (frontend) · Node + Express + Mongoose (backend, plain JavaScript) · MongoDB (database)
· a pure-TypeScript scheduling engine shared by browser and server.

```
Browser (React + Zustand)  ──/api──▶  Express  ──▶  MongoDB
   engine: instant preview             engine: authoritative publish gate
```

## Quick start

```bash
npm install
cp .env.example .env          # set MONGODB_URI (a free MongoDB Atlas cluster is fine)
npm run dev                   # API on :4000, web on :5173 (Vite proxies /api)
```

An empty database is **auto-seeded** on first start (33 employees, 20 brands, 3 pods, a generated December 2026 draft).
Reset anytime with `POST /api/seed?force=true`.

```bash
npm test          # 10 tests: engine rules, determinism, change handling, store<->API wiring
npm run typecheck
npm run build     # production frontend into dist/
npm start         # API + serves dist/ on one port
```

### Deploy (one service)
Render / Railway web service: **Build** `npm install && npm run build` · **Start** `npm start`.
Env: `MONGODB_URI` (Atlas; allow the host in Network Access) and optional `PORT`. The Express server serves the React build and `/api`
from the same origin. To host the frontend separately (e.g. Vercel), set `VITE_API_URL` to the API URL and `CLIENT_ORIGIN` on the API.
Free tiers sleep when idle, so open the URL once before a demo.

## What it does (mapped to the brief)

| Requirement | Where |
|---|---|
| Central DB of employees, brands, processes, pods, leads, allocations | **Data** tab, CRUD over MongoDB, no code changes needed |
| Working-day rules and minimum coverage | Per-process calendar (365 / holidays off / Sundays+holidays off), min staff, per-weekday and per-date minimums, extra closed dates |
| Availability, weekly offs, leaves, comp-offs, holidays | Absences + holidays in Data; weekly offs are generated |
| Generate a monthly roster | **Generate roster** (deterministic, ~40 ms) |
| Company / pod / brand / process / employee views | **Roster** tab view switcher |
| Conflicts and coverage gaps before publishing | Live validation, **Issues** and **Coverage** tabs, publish gate |
| Manual edits with validation | Click a cell; validated instantly and persisted; edits are *pinned* |
| Handle changes without rebuilding | **Change simulator**: preview, auto-repair of only the affected week, approve |
| Mandatory vs preference | Every issue is tagged; coverage always outranks preferences |
| Optional extras done | Backup resources, ranked fix suggestions, fair weekend-off rotation, preference scheduling, CSV export, audit log, publish workflow with override reason |

## Sample data
33 employees (3 pod leads, 16 sole owners, 11 in multi-employee brands, 3 pod floaters), 20 brands. **16 brands (80%) have one dedicated
employee** owning every process; 4 brands have 2-3 employees with **separate and overlapping** process ownership (e.g. two people share
Craftly Customer Support; Orbit Customer Support needs 2 people on Fri/Sat). Calendars are mixed per process. Holidays: 25 Dec, 1 Jan, 26 Jan.

## Assumptions (all configurable in Data → Global rules / Employees / Processes)
- A week is Mon-Sun. A partial week owes `round(days × weeklyOffs / 7)` offs, so 4+ days of a week = 1 off.
- **A calendar closure is a day off.** If none of an employee's owned processes operate that day (Sunday-closed brand, public holiday) the cell is `CL`/`PH`, and a `CL` counts as their weekly off.
- Leave does **not** replace the weekly off by default (setting available).
- A backup is *booked as relief* on top of their own work; one person may cover up to `maxBrandsPerDay` brands (default 3).
- Each month is planned independently (no carry-over of the previous month's last off day).
- Comp-off *accrual* for working a holiday is not computed; approved comp-offs are entered as absences.

## API (Express)
`GET/POST/PUT/DELETE /api/{pods,employees,brands,processes,assignments,absences,holidays}` · `GET /api/config` · `PUT /api/settings`
`GET /api/rosters` · `GET /api/rosters/:month` · `POST …/generate` · `PATCH …` (manual edits) · `GET …/validation`
`POST …/suggestions` · `POST …/absence` (`apply:false` = dry run) · `POST …/publish` · `GET …/export.csv` · `GET /api/changelog` · `POST /api/seed`

## Project layout
```
src/engine/   scheduling engine (pure TS): rules, validate, generate, suggest, index (repair, applyAbsence)
src/data/     seed data
src/          React app: api.ts, store.ts (Zustand), App.tsx, components/
server/       Express API: models.js, service.js, routes.js, index.js
```

---

# Tell us how you think

**1. How did you model employees, brands, processes, pods and their relationships?**
Employees are assigned to **processes**, not brands; a brand is just a group of processes. An `Assignment` is (employee, process, role)
with role `primary` (owns the work) or `backup` (relief). A sole-resource brand is simply one employee holding every process of that
brand, so single, shared and multi-brand cases are the same model with no special branches. A process carries its own operating
calendar and minimum staffing (default, by weekday, by date). Pods group employees and have a lead. Crucially, a **brand's operating
calendar is separate from an employee's schedule**: the schedule is derived from the calendars of the processes they own.

**2. How does the system generate a roster and decide whether it satisfies the constraints?**
Absences, holidays and closures are *facts*; the only *decision* is which day each employee takes their weekly off. Generation walks
week by week, most-constrained employees first (least slack), and for each weekly off picks the day with the lowest cost: a coverage
shortfall costs 1000 (150 if a backup exists), breaking max consecutive days 5000, a non-preferred day 20, plus small terms for spreading
offs across a pod, rotating weekend offs fairly and keeping offs about 7 days apart. Ties go to the earliest day, so output is deterministic.
Then backups are booked as relief, and a local pass shifts weekly offs where that strictly reduces mandatory issues. A separate
**validator** is the judge. It recomputes coverage per process per day plus leave conflicts, consecutive days, missing weekly offs,
overload, invalid relief and preferences, independent of how the roster was produced. The same validator runs after manual edits and at publish.

**3. Single-resource vs multi-employee brands?**
There is no separate code path. Coverage is "working owners + booked relief ≥ required" for every process-day. For a sole owner, any
working-day off drops that to zero, so the generator cheaply prefers days the process is closed (a Sunday-closed brand needs no relief at
all) and otherwise books the pod floater. In multi-employee brands, teammates back each other up on processes they do not own, and shared
processes simply have two owners, so one off still leaves coverage.

**4. A sole owner is unavailable on a required day?**
The validator reports `NO_COVERAGE`, naming the process, the date and who is assigned and why they are out. The change simulator shows
this before approval. Auto-repair then re-plans only that person's week (everyone else and all pinned cells stay), re-books relief from
designated backups, then other floaters. If it is still uncovered, it stays a red cell; the fix drawer lists simulated options (relief
candidates, moving a weekly off, reviewing the leave), each scored by issues fixed minus issues created.

**5. Conflicting requirements or insufficient staffing?**
Mandatory (coverage, leave, consecutive days, weekly offs) versus preference (preferred off day) is explicit. The generator will never
trade coverage for a preference. When it cannot satisfy everything it does **not** hide it: the gap is flagged with the cause. Publishing
is blocked while mandatory errors exist unless the manager supplies a written reason, which is stored with the roster and the audit log.

**6. Automated vs human control?**
Automated: weekly-off placement, relief booking, validation, ranking of fixes, week-level repair after a change. Human: approving leave,
choosing among fixes, hand edits (which are pinned and never overwritten by regeneration), and publishing, plus any override with a
reason. Leaves and closures can't be hand-edited, so a roster cannot contradict its own inputs. Staffing trade-offs have client and
people consequences, so the tool recommends and simulates but the manager commits.

**7. If the team and brand count doubled?**
The model scales as is. The engine is O(people × days × processes), 36 ms today. What changes: (a) move generation to a background job
and keep the browser to validation, (b) swap the greedy search for a constraint solver (CP-SAT) behind the same validator, since the
validator and suggestion layers are solver-independent, (c) virtualise the grid and make validation incremental (only re-check the
changed employee-day and the processes they touch), (d) split roster storage per pod and add auth, roles and per-pod approval.

**8. One more week?**
First, authentication with roles (pod lead approves, ops manager publishes) and notifications when a published roster changes. Then
carry-over across months (streaks and last off), comp-off accrual for holiday work, comparing alternative plans side by side, and
end-to-end tests against a real MongoDB.

## Known limitations
- Verified by type-check, a production build, and 10 automated tests (engine and store wiring against a mocked API). The Express routes load
  and the server starts, but **have not been exercised against a live MongoDB in this environment**. Run the smoke test below on first use.
- The UI has not been visually reviewed in a browser here.

### Smoke test
```bash
curl localhost:4000/api/health
curl localhost:4000/api/rosters/2026-12
curl -X POST localhost:4000/api/rosters/2026-12/absence -H 'content-type: application/json' \
  -d '{"employeeId":"e22","date":"2026-12-21","type":"L"}'      # dry run
```
#   D a t a s t r a w  
 