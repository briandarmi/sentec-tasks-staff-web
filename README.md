# Sentec Tasks — Staff Web

The **staff workspace** for [Sentec Tasks](../docs/sentec-tasks.md): the queue a
housekeeper, engineer or team leader actually works from. Mobile-first, because
it is used one-handed while walking a corridor.

Property configuration and the Sentinel Tech platform screens are a separate
app, [`../sentec-tasks-admin-web`](../sentec-tasks-admin-web). This repository is
**self-contained**: clone it from GitHub on its own, `pnpm install`, and it
builds. It depends on no sibling repository and no shared package.

Tasks is not a Butler module. Butler, Sentec PMS and Sentec EMS are all just
*integration partners* that dispatch work into it, and Tasks stays fully usable
with no partner connected at all.

## Two backends, one contract

`pnpm dev` runs this app against the **dev copy of `sentec-tasks-api`** on AWS
Lambda through a local proxy (see [Running against the dev API](#running-against-the-dev-api)).
Tests, static builds (GitHub Pages, CloudFront) and `NUXT_USE_MOCK=1 pnpm dev`
run against the in-browser mock:
[`app/utils/clientFakeApi.ts`](app/utils/clientFakeApi.ts). Since 2026-09-02
that mock is **wire-faithful to `sentec-tasks-api`** (Go + PostgreSQL, pinned
at `master` commit `c3f52ad` plus the passwordless sign-in branch
`feat/google-and-magic-link-auth` @ `48756a3`, re-aligned 2026-09-16, the
`feat/projects` branch @ `fe5e99d` — per-hotel roles, projects, checklist
steps, recurring tasks, hotel time zone, time attribution — reconciled
2026-09-29 against its Go handlers and openapi.yaml, and the
`refactor/ponytail-audit` tip @ `1ee8c12`, 2026-10-06 — escalation policies
and the escalation sweep, department soft delete, EMS staff sync and
offboarding, the main/interface surface split): the
exact paths, methods, response envelope, UUID ids,
`X-Hotel-Id` scoping, error codes and message literals, and the serialization
quirks (`data: null` for an empty task list but `[]` for config lists;
`meta.total`, not `totalCount`; `meta.warnings: null` on a clean create) —
extracted from the Go handlers and their tests, not just the OpenAPI file.

The live transport is the other half of `transport()` in
[`useSession.ts`](app/composables/useSession.ts): `$fetch` with credentials
against the same paths and shapes, so the two backends are interchangeable
per request. What a browser mock cannot BE, it simulates at the seam and says
so:

- **JWT verification** — `Bearer service:…` / `Bearer partner:<id>` stand-ins,
  and staff bearer tokens minted at login.
- **The httpOnly cookie** — the session id rides in the login response's
  `_sessionCookie` (a mock-only field) and is replayed as `Cookie: st_session=…`;
  the CSRF discipline (`X-CSRF-Token` on every mutation) is real.
- **The two redirecting sign-in legs** (Google callback, magic-link verify)
  answer a real 302 whose `Location` the mock reports in `headers`, with the
  `Set-Cookie` it cannot honour beside it; the login screen "follows" that
  redirect in-app and adopts the id through the same seam. Google itself is
  an account chooser the screen renders in place of the consent page, and the
  mail transport is the API's own dev-console one (link printed, plus a
  "demo inbox" on the screen).
- **S3** — presigned uploads validate exactly what the API validates and hand
  back real-shaped storage keys; the bytes go nowhere and signed GET URLs are
  stable placeholders.
- **The two workers** — the recurring-task sweep and the escalation sweep
  run lazily before every authenticated request, so due templates and due
  escalation steps have landed before any read could show them.
- **EMS** — a seeded in-memory directory stands in for EMS's employee list,
  and `PUT /v1/ems/hotels/{syncId}/employees/{id}` with the EMS partner token
  plays an EMS push.
- **EventBridge events, PostgreSQL partitions, bcrypt** — not simulated at all.

Scope is by **hotel**: every hotel-scoped request carries `X-Hotel-Id`, which
for a human must be in their token's hotels claim (in PostgreSQL this is the
`hotel_id` LIST partition key every task table is partitioned by).

## Getting started

```bash
pnpm install                 # from the workspace root
pnpm dev:tasks-staff         # live, against the dev API: http://localhost:3000
NUXT_USE_MOCK=1 pnpm dev     # the in-browser mock, with the demo accounts below
```

Live, sign in with a real Sentec Tasks account (the dev database has no demo
people). On the mock, sign in with any of the demo accounts listed on the
login screen (email + password, per the real auth model):

| Email                            | Password       | Who they are                                   |
| -------------------------------- | -------------- | ---------------------------------------------- |
| `staff@aston.example`            | `staff123`     | HK staff (Budi), works two Aston properties    |
| `leader@aston.example`           | `leader123`    | HK leader (Sari) — assigns and reviews         |
| `admin@aston.example`            | `admin123`     | Property admin (Agus)                          |
| `operator@sentineltech.example`  | `operator123`  | Platform operator — **no hotel claim at all**  |
| `regional@aston.example`         | `regional123`  | Admin at Kuningan + an Aston-wide group grant  |

The seed also carries `made@aston.example` (staff **without** the createTask
claim) and `joko@aston.example` (Maintenance staff) for exercising the gates.

```bash
pnpm test          # this repo's own copy of everything, plus the staff-only helper specs
pnpm typecheck     # vue-tsc across app + templates
pnpm build         # static SPA into .output/public
pnpm check:shared  # byte-compares the duplicated files with the admin console
```

## Kept in step by hand

Eleven files are **duplicated** between this app and the admin console:

| File                             | Why both apps need it              |
| -------------------------------- | ---------------------------------- |
| `app/composables/useSession.ts`  | Same auth model, same mock         |
| `app/composables/useTasksApi.ts` | Same API contract                  |
| `app/composables/useCaps.ts`     | Same role model                    |
| `app/composables/useTheme.ts`    | Same theme storage key             |
| `app/composables/useTenant.ts`   | Same hotel record and display zone |
| `app/plugins/session.client.ts`  | Restore before the first route     |
| `app/utils/clientFakeApi.ts`     | Same mock, same seed data          |
| `app/utils/task-ui.ts`           | Same status and SLA presentation   |
| `app/utils/select-empty.ts`      | Reka UI's reserved-empty-value fix |
| `app/utils/sign-in.ts`           | Same returnTo and authError copy   |
| `app/utils/session-cookie.ts`    | Same credential cookie attributes  |

Plus `tests/mock-api.spec.ts`, `tests/admin-config.spec.ts`,
`tests/staff-flows.spec.ts`, `tests/api-fidelity.spec.ts`,
`tests/sign-in.spec.ts`, `tests/session-cookie.spec.ts` and
`tests/task-ui.spec.ts`, duplicated for a reason: each repo tests the copy it
ships. A change to any file above belongs in both apps in the same change, and
`pnpm check:shared` fails when the copies differ (it skips when the sibling
repo is not checked out, so a standalone clone still builds).

## Screens

| Route         | What it is                                                      |
| ------------- | --------------------------------------------------------------- |
| `/`           | My work — assigned to me, plus my department's unclaimed queue   |
| `/tasks`      | Full list; server-side filters live in the URL, paging is keyset; queue chips carry server totals; optional group-by-source lanes, most urgent lane first |
| `/tasks/[id]` | Detail: room-first header, project chip, claim (pool-aware), assign, return, delegate, helpers, checklist steps (tick / note / hand over / add / remove), submit / review (with the other pending reviews), move, "who held it" time split, comment, attach & upload |
| `/tasks/new`  | Raise a task, with a live preview off the API's own resolver; start from a shared template; "Repeat" turns it into a recurring task; `?projectId=` raises it inside a project |
| `/board`      | Board view of the property's columns (project tasks are not on it) |
| `/projects`   | Projects I belong to (every project, for admins), one status at a time, with progress, late and needs-manager flags; leaders and admins open new ones |
| `/projects/[id]` | One project: header and progress, edit / complete / cancel / reopen / hand over for the manager or an admin; Board (the property's columns, the project's cards), Tasks (new, add existing, remove) and Members (levels, auto-joined, add / remove) |
| `/recurring`  | "Repeats": my recurring tasks — schedule, next and last run, pause / resume, edit, archive; the scheduler's `lastError` when it paused one |
| `/offers`     | Delegation offers waiting on my accept or decline               |
| `/profile`    | Identity, property switch, the hotel's timezone, Repeats, theme, sign out |
| `/login`      | The only public route                                            |

Every role uses this app. Individual actions appear or not via `useCaps()` —
notably `createTask`, which since feat/projects is **per property** (read from
the membership at the selected hotel, like the role itself) and which plain
staff need before they may raise work at all.

## What the contract dictates (and this app honors)

- **[DR-15] visibility (feat/projects).** Leaders and admins see everything
  at the hotel. A plain staff member sees: tasks they claimed; unclaimed tasks
  in their department (returned-to-pool included); unclaimed tasks with **no
  department, across the whole property**; pools of teams they belong to;
  tasks with a checklist step handed to them (read-only); and every task of a
  project they belong to. A colleague's claimed task is never visible.
  Filtering by department drops the no-department arm, so a filtered list can
  be smaller than the unfiltered one — intended. An explicit `assignedStaffId`
  filter is *clamped* to their own id, and an out-of-scope task detail is the
  same 404 a missing one gets. **Project tasks are left out of the default
  list and the hotel board**; they show under Mine / Helping, in offers, in
  detail, and in the project itself. The list's "What shows here" says all of
  this in the viewer's terms.
- **Checklist steps.** `TaskDetail.checklist` is the only read. Tick / untick
  with an optional note (≤ 2000 chars; absent keeps it, null clears it,
  unticking keeps it); add up to 50 steps of ≤ 200 chars; remove; hand a step
  to a person in the task's department (any member when it has none) — the
  task must be claimed first, and the person gets read-only access to the
  task (they may tick and annotate their own step only) and joins the project
  automatically if there is one. All four routes 409 once the task is
  FINISHED / VERIFIED / CANCELLED; SUBMITTED still takes edits. Who may do
  what is the API's call; `app/utils/checklist-access.ts` mirrors it for what
  to show.
- **Projects.** Admins and leaders open them; the creator is the manager.
  The manager passes every leader / admin check on the project's tasks
  (assign, move, review, helpers, checklist), so the detail widens those
  controls for them. Anyone handed a project task by name (assign, claim,
  accepted offer, helper, checklist step) becomes a MEMBER with
  `source: AUTO`; team and department pools add nobody. Members and managers
  comment on project tasks; viewers do not (the comment box hides). Project
  tasks leave the hotel board and default list. Complete is allowed with open
  tasks (the response's `openTasks` is shown); reopen 409s on a name clash;
  membership changes 422 on a closed project; the manager row is changed only
  through Hand over. People who cannot see a project get 404, not 403. A
  project task assigned to someone in another department moves to that
  department, due times unchanged.
- **Recurring tasks.** "Repeat" on the new-task form posts to
  `/v1/recurring-tasks`: the API makes a personal template **and the first
  task now**; the worker makes the rest on the schedule (`timeMinutes` after
  hotel-local midnight, weekdays with 0 = Sunday, day of month 1–28, optional
  hotel-local window). Template content has no due date, activation date or
  requester, and no DEPARTMENT assignee (STAFF / TEAM / UNASSIGNED only; plain
  staff may assign only themselves or their own team). PUT is a full replace,
  so pause / resume sends the current content and schedule back. If the owner
  loses access or the create-task permission, the worker pauses the template
  and fills `lastError` — /recurring shows it prominently. Shared templates
  (`scope=shared`, active) are the quick-pick at the top of the form.
- **Hotel timezone.** Every clock time on screen is the hotel's
  (`GET /v1/tenant` → `timezone`, via `useTenant()` and the formatters in
  `task-ui.ts`), not the device's; the profile says which zone. Changing it
  is an admin action in the admin console.
- **Claim never steals; assign is the hand-over.** A pool task (TEAM or
  DEPARTMENT) is claimable by its members only; department sync refuses
  cross-department claims/assigns except by an admin.
- **SLA clocks chain, and the numbers are stamped with their verdicts.**
  `resolutionDueAt` is open-hours minutes from `responseDueAt` (not from
  activation). Since the API's 2026-09-02 SLA spec (`c3f52ad`) both
  `responseDuration` and `resolutionDuration` are **open-hours minutes from
  activation** — response to the first IN_PROGRESS, resolution to the moment
  work stopped (submission, or a direct FINISHED) — written at the same
  instant as their verdict, so the pair can never disagree. Parked time
  counts; leaving IN_PROGRESS writes nothing (the old accumulator is gone); a
  review bounce resets the verdict but leaves the superseded number in place
  until the resubmission re-stamps both from activation; approval and later
  detours never re-stamp. The timeline reads a number only beside a verdict.
- **SUBMITTED is frozen** for staff; a leader may only park or cancel it —
  review is the deciding action, leader-of-the-department or admin.
- **No free-text search and no department filter on the list.** The search box
  filters the *loaded* rows and says so; the chips map 1:1 to real parameters.
- **Time attribution.** `GET /v1/tasks/{id}/attribution` — who held the task
  for how long, in open-hours minutes, from activation to submission (or "so
  far" while open). The split (unclaimed / pooled / per holder with hold
  counts) is shown only when `reconciles` is true; otherwise just the total,
  with a line saying why.
- **Attachments**: the detail carries non-removed rows only (a removed one is
  gone, not restorable from here); `filepath` may be `""` — preview
  unavailable; uploads are presigned with per-type size caps and the storage
  key's extension comes from the content type, never the filename.
- **A helper's directory is leaders-only — with two exceptions.**
  `GET /v1/staff/assignable` refuses plain staff unless the call names a task
  they currently hold (`taskId`) or a project they manage (`projectId`);
  neither filters the list. The detail screen passes `taskId` into every
  picker, and the project page passes `projectId`. With neither, the
  delegate / helper pickers degrade to the caller's own teams' member ids,
  labeled as such.
- **Escalation** (`refactor/ponytail-audit`, 2026-10-06). A task resolves its
  escalation policy once at creation — the matched routing rule's, else the
  SLA's, else the hotel's active default, else none — and the API's worker
  applies each due step once, in working minutes on the task's schedule:
  bump the priority, reassign to a person or a team, route to another
  department, notify (department leaders, admins, a team, named staff, the
  previous assignee). Steps are independent and never fire twice; an
  inactive policy stops escalating. The task carries `escalationPolicyId`,
  `escalationLevel` (highest applied step + 1) and `escalatedAt`; the detail
  shows an "Escalated · Level N" pill and an Escalation card from
  `GET /v1/tasks/{id}/escalations` (what each step changed, what it skipped
  and why, who was told); the worker's history rows read "Escalated (level N,
  …)" verbatim; the new-task preview names the policy a task would get
  (`escalationPolicyName`). Policies are edited in the admin console.
- **Two API deployments.** Staff and admin calls go to the *main* API; partner
  tokens (Butler, PMS, EMS) are accepted by the *interface* API only, where
  dispatch (`POST /v1/tasks`), guest attachments and the EMS push live. The
  mock gates the same way: a partner token on a main route is 403 "partner
  tokens must use the interface API", a staff cookie on dispatch is 403 "the
  interface API accepts partner tokens only".
- **Inactive departments.** A hotel can soft-delete a department
  (`HotelDepartment.isActive: false`; `masterIsActive: false` when the
  platform retired the master). Staff, teams, schedules and tasks that point
  at it keep working and show it as inactive; nothing new may choose it.
- **Offboarding.** When an admin removes someone from the property, or
  deactivates their account, or EMS says they left, their open tasks go back
  to their pools by the Return rule (an IN_PROGRESS task returns to NEW with
  the reason in history: "Removed from this property by an admin", "Account
  deactivated", "Left the property (EMS)"), and their helper, offer,
  checklist-step and team roles are cleared.

## Running against the dev API

`pnpm dev` talks to the dev copy of `sentec-tasks-api` (`refactor/ponytail-audit`)
on AWS Lambda **by default** — the Function URL is `DEV_API_URL` in
`nuxt.config.ts`. The API signs you in with the `SameSite=Lax` `st_session`
cookie, so the app and the API must look like **one site** to the browser:
`nuxt dev` proxies `/v1/*` to the Function URL (`nitro.devProxy`,
`changeOrigin` because a Function URL routes on the Host header) and the app
calls its own dev server. Nothing to configure; `.env.example` lists the
overrides:

```bash
pnpm dev                     # live data, http://localhost:3000
NUXT_USE_MOCK=1 pnpm dev     # the in-browser mock instead (what the tests use)
NUXT_DEV_API_PROXY=http://localhost:8080 pnpm dev   # a local `go run ./cmd/server`
```

- Open the app at **http://localhost:3000, never 127.0.0.1** — a different
  site, so the cookie will not match and the origin is not on the API's
  allow-list (`CORS_ALLOWED_ORIGINS` = `localhost:3000`, `localhost:3001`).
  This app is pinned to port 3000 (`devServer.port`), the admin console to
  3001. `NUXT_PUBLIC_API_BASE` must be this app's own dev server, never the
  Function URL itself.
- Google and magic-link sign-in come back **through port 3000**
  (`GOOGLE_REDIRECT_URL` and `API_BASE_URL` on the Lambda point at it), so keep
  this dev server running for either flow, from the admin console too.
- The Lambda runs with `MAIL_DEV_CONSOLE=true`: magic links are **not emailed**,
  they land in the Lambda's CloudWatch log. Use password login if you cannot
  read that log.
- The dev database has no demo accounts: sign in with a real account. Live,
  the login screen hides the demo accounts, demo inbox and stand-in Google
  chooser (`useSession().isLive`) and says it is connected to the development
  API; the sign-in flows themselves are unchanged.
- Static builds (`pnpm generate`: GitHub Pages, CloudFront) have no dev proxy
  and stay on the mock unless `NUXT_PUBLIC_API_BASE` names a same-site API.
- Verified 2026-10-07: `/v1/*` through the dev server reaches the Lambda (a
  wrong password answers the API's own 401 envelope; the served runtime
  config points at the dev server). A full sign-in was not exercised here,
  for want of a dev account on this machine.

## Auth

Three ways in, one session. `POST /v1/auth/staff/login?delivery=cookie`
(password, kept as the transition fallback), `GET /v1/auth/google/callback`
(Google Sign-In, a backend authorization-code flow with PKCE) and
`GET /v1/auth/magic-link/verify` (an emailed single-use link, 15 minutes) all
set the same `st_session` cookie (12-hour shift window) — there is no separate
actor kind, and neither passwordless path can create an account. The password
login returns the CSRF token in its body; the two redirect-based paths hand the
app nothing but the cookie, so it recovers the token from
`GET /v1/auth/session`, exactly as it does after a refresh.

The login screen offers Google first, the emailed link as the default for an
address, and the password behind "use a password instead". Both passwordless
paths return to the login screen itself (`returnTo`, deep link in its query),
which renders the closed set of `?authError=` codes from
[`app/utils/sign-in.ts`](app/utils/sign-in.ts) — never the raw value — and the
auth middleware then honours the deep link. `POST /v1/auth/magic-link/request`
always answers `202`, so the screen never confirms that an address exists.
Sign-out clears everything on the device, including the selected property —
correct for a shared shift device, and the profile screen says so.

## Where the session lives: a cookie, not Web Storage (2026-09-17)

The credential is in a cookie written by the app, through
[`app/utils/session-cookie.ts`](app/utils/session-cookie.ts) (identical in all
four frontends): `SameSite=Strict`, `Secure` when served over https, `Path`
scoped to this app's base URL so a sibling app on the same origin cannot read
it by name, and a `Max-Age` the browser enforces even if the app is never
opened again. Only the secret goes in the cookie — a cookie is capped at 4 KB
and the helper throws rather than truncate a credential.

What this does not buy, said plainly: a cookie written by script cannot be
`HttpOnly`, so a script injected into the page could read it exactly as it
could read localStorage. That protection needs the API to set the cookie,
which these static, cross-origin builds cannot use. See the helper's header.

Here: cookie `sentec-tasks-session` holds the session id the mock stands in
for the API's httpOnly `st_session` with, `Max-Age=43200` like the real one.
It replaced sessionStorage: a cookie is per browser rather than per tab, so a
closed tab no longer ends the shift — the 12-hour clock does, on both the
cookie and the mock's session row. A leftover sessionStorage id is adopted
once and removed. Nothing else is stored; identity and the CSRF token come
from `GET /v1/auth/session` on boot, as before.

## Session expiry: automatic sign-out (2026-09-17)

A session the API no longer accepts is dropped on this device and the user is
sent to `/login`, instead of every screen failing on the same 401 while the
sidebar still shows them signed in.

Two triggers, one landing:

- **A 401 from any request** (`useSession.request`). The `st_session` cookie
  is past its 12-hour window, was revoked by a sign-out elsewhere, or is
  unknown after a server restart. `isSessionInvalidError` in
  [`app/utils/sign-in.ts`](app/utils/sign-in.ts) matches status 401 or code
  `UNAUTHORIZED`. A **403 is not a trigger** — that is a live session lacking
  a permission. The logout call itself is exempt: a 401 there means "already
  gone". Teardown + navigation is single-flight, so a screen's parallel loads
  push `/login` once, and the failing request still throws so the calling
  screen stops its own flow.
- **Boot found a stored session id the server no longer knows**
  (`restore()` → `recover()` fails). The plugin already forgot the id; it now
  also sets `expiredOnRestore`, which the auth middleware reads once to add
  `reason=expired` to the redirect it was already making.

What happens: `expireSession()` runs the same local teardown as `logout`
(identity, session id, every cached payload, the selected property) **without**
`POST /v1/auth/logout`, then `navigateTo('/login?reason=expired&redirect=<page>')`.
The login screen shows the calm "Signed out — your session has ended" notice
(`sessionEndedNotice`; only `expired` is known, the raw value is never
rendered) and, after signing in, returns to `redirect` via the existing
`safeRedirectPath`. There is no client-side expiry pre-check: the cookie is
httpOnly and carries nothing readable, unlike the Butler apps' JWT `exp`.

`useSession.ts`, `sign-in.ts` and `tests/sign-in.spec.ts` are shared with the
sibling app byte-for-byte (`pnpm run check:shared`). Tested:
`tests/sign-in.spec.ts` pins `isSessionInvalidError` and `sessionEndedNotice`;
the redirect itself needs the Nuxt runtime and was checked by typecheck and
build only.

## Kept in step with the remote staff app

The remote `sentec-tasks-web` (SentinelTech-com, `master`) is the reference
this app is periodically re-aligned with. Its 2026-09-03 redesign
(`docs/superpowers/specs/2026-09-03-staff-app-redesign-design.md` there) was
ported as **information architecture, not palette** — the Sentinel Tech Design
System stays untouched, per the standing decision:

- **Three signals, kept apart.** SLA urgency is the only meaning of the
  red/amber tones (card stripe, running clock — amber inside 30 minutes,
  breached reads `due HH:MM · 25m over`); the source app is a small dot in the
  registry's own colour (data, never a token); lifecycle status keeps its own
  pill. Scan order on cards and the detail header: stripe, room, clock, title.
- **Queue chips carry server totals** (`Mine (4)`, `Helping (1)`, and for
  leaders `In review (2)`) from `limit=1` list calls read for `meta.total`;
  a failed count leaves the plain label. "To claim" is the remote's "Team pool"
  and stays a client-side view — the API has no unclaimed filter.
- **Group by source** is a display toggle over the loaded rows (client state,
  never in the URL): one lane per originating app, the lane holding a breached
  task first, then due-soon, then the rest; unregistered codes fold into
  "Other". It hides itself when the registry fetch failed. The pure grouping
  lives in `app/utils/source-lanes.ts`, pinned by `tests/source-lanes.spec.ts`.
- **Review is a sign-off slip**: submitted at `HH:MM · on time / late` from the
  verdict stamped at submission, "Request changes" reads as the non-happy path,
  and up to three other SUBMITTED tasks are listed beneath as "Also pending"
  (best effort — a failed fetch renders nothing). The detail gains a
  "Created by" row naming the source app for every task.

Deliberately **not** ported: the brass/teal tokens and neutral status chips
(design decision above); inline dashed panels in place of the return dialog and
the move/assign sheets (this app's secondary flows are sheets and dialogs by
design); proof-photo thumbnails (the mock has no object store, so `filepath`
is a placeholder URL that would render as a broken image — the photo count and
link list stay); the `.design-sync` tooling (remote-only).

## Deploying to GitHub Pages

[`.github/workflows/pages.yml`](.github/workflows/pages.yml) builds the shell
and publishes it to GitHub Pages on every push to `feat/overview-compliance`
(or by hand from the Actions tab). The published site is a *project* page,
so it lives under `/sentec-tasks-staff-web/`; the workflow passes that path to Nuxt as
`NUXT_APP_BASE_URL`, and `nuxt.config.ts` reads it into `app.baseURL` — the
repository name is never hardcoded, so a fork publishes under its own name.

Because the app runs entirely against its in-browser mock, nothing else is
needed: no backend, no secret, no environment file. Two host-specific details
are already handled:

- **Deep links.** Pages has no rewrite rule, but it serves `404.html` for any
  unknown path, and the static preset emits `404.html` as a byte-identical copy
  of the shell — so `/sentec-tasks-staff-web/tasks/…` loads the app, which then routes.
- **`_nuxt/` and `_fonts/`.** Jekyll would drop underscore-prefixed
  directories. The Actions deploy never runs Jekyll, and `public/.nojekyll`
  makes that explicit for anyone who switches the source back to a branch.

A local build of the same artifact, for checking before pushing:

```bash
NUXT_APP_BASE_URL=/sentec-tasks-staff-web/ pnpm generate
# then serve .output/public at that sub-path, e.g.
# mkdir -p /tmp/pages && ln -sfn "$PWD/.output/public" /tmp/pages/sentec-tasks-staff-web && npx serve /tmp/pages
```

Deploying from a branch other than the repository's default needs one more
thing: the `github-pages` environment only admits the branches listed in its
deployment-branch policy (Settings → Environments → github-pages), and GitHub
seeds that list with the default branch at the time Pages was enabled. A deploy
from an unlisted branch fails at the deploy step with "not allowed to deploy to
github-pages due to environment protection rules" even though the build passed.
Add the branch there (or via
`gh api -X POST repos/<owner>/<repo>/environments/github-pages/deployment-branch-policies -f name=<branch> -f type=branch`)
and re-run the failed job.

The repository ships its own `pnpm-lock.yaml` so the workflow can run
`pnpm install --frozen-lockfile`. Inside the shared workspace pnpm reads only
the root lockfile and ignores this one; regenerate it after a dependency
change with `pnpm install --lockfile-only --ignore-workspace`. The same section
lives in [`sentec-tasks-admin-web`](../sentec-tasks-admin-web#deploying-to-github-pages).

## Design system

Nuxt 4 SPA (`ssr: false`), shadcn-vue (`new-york`, Tabler icons), Tailwind 4,
Quicksand, Sentinel Blue `#27A5F7` — the colour layer comes verbatim from the
**Sentinel Tech Design System** (`--st-*` scale in
`app/assets/css/tailwind.css`), with dark mode derived from the Sentinel Grey
scale. Mobile-first: 44px targets, one column capped rather than a second pane.

## Not verified yet

- **No browser or component tests.** This environment has no working headless
  browser (`libnss3` missing, install needs root). `pnpm build` and
  `pnpm typecheck` pass, which covers templates and types but not runtime
  rendering.
- **Sign-in against the dev API.** The proxy and the API's error envelope were
  checked from this machine (2026-10-07); a real account was not available to
  sign in with, so the screens have been exercised against the mock only.
- **The escalation sweep's clock is the mock's.** It uses the same
  schedule-aware minute arithmetic as the SLA deadlines (`Intl` zone offsets,
  not a tz database) and is pinned by `tests/api-fidelity.spec.ts`; against
  the Lambda the sweep is the API's own worker on its own schedule.
