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

## The mock is the real API's contract

There is no server in this workspace; the app runs against an in-browser mock:
[`app/utils/clientFakeApi.ts`](app/utils/clientFakeApi.ts). Since 2026-09-02
that mock is **wire-faithful to `sentec-tasks-api`** (Go + PostgreSQL, pinned
at commit `0c8e1bd`): the exact paths, methods, response envelope, UUID ids,
`X-Hotel-Id` scoping, error codes and message literals, and the serialization
quirks (`data: null` for an empty task list but `[]` for config lists;
`meta.total`, not `totalCount`; `meta.warnings: null` on a clean create) —
extracted from the Go handlers and their tests, not just the OpenAPI file.

Swapping the mock for the real API means replacing the `request()` body in
[`useSession.ts`](app/composables/useSession.ts) with `$fetch` and a base URL —
the headers, paths and shapes are already the real contract. What a browser
mock cannot BE, it simulates at the seam and says so:

- **JWT verification** — `Bearer service:…` / `Bearer partner:<id>` stand-ins,
  and staff bearer tokens minted at login.
- **The httpOnly cookie** — the session id rides in the login response's
  `_sessionCookie` (a mock-only field) and is replayed as `Cookie: st_session=…`;
  the CSRF discipline (`X-CSRF-Token` on every mutation) is real.
- **S3** — presigned uploads validate exactly what the API validates and hand
  back real-shaped storage keys; the bytes go nowhere and signed GET URLs are
  stable placeholders.
- **SQS events, PostgreSQL partitions, bcrypt** — not simulated at all.

Scope is by **hotel**: every hotel-scoped request carries `X-Hotel-Id`, which
for a human must be in their token's hotels claim (in PostgreSQL this is the
`hotel_id` LIST partition key every task table is partitioned by).

## Getting started

```bash
pnpm install              # from the workspace root
pnpm dev:tasks-staff      # or: pnpm --filter sentec-tasks-staff-web dev
```

Sign in with any of the demo accounts listed on the login screen (email +
password, per the real auth model):

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
pnpm test          # 102 tests over this repo's own copy of everything
pnpm typecheck     # vue-tsc across app + templates
pnpm build         # static SPA into .output/public
pnpm check:shared  # byte-compares the duplicated files with the admin console
```

## Kept in step by hand

Eight files are **duplicated** between this app and the admin console:

| File                             | Why both apps need it              |
| -------------------------------- | ---------------------------------- |
| `app/composables/useSession.ts`  | Same auth model, same mock         |
| `app/composables/useTasksApi.ts` | Same API contract                  |
| `app/composables/useCaps.ts`     | Same role model                    |
| `app/composables/useTheme.ts`    | Same theme storage key             |
| `app/plugins/session.client.ts`  | Restore before the first route     |
| `app/utils/clientFakeApi.ts`     | Same mock, same seed data          |
| `app/utils/task-ui.ts`           | Same status and SLA presentation   |
| `app/utils/select-empty.ts`      | Reka UI's reserved-empty-value fix |

Plus `tests/mock-api.spec.ts`, `tests/admin-config.spec.ts`,
`tests/staff-flows.spec.ts`, `tests/api-fidelity.spec.ts` and
`tests/task-ui.spec.ts`, duplicated for a reason: each repo tests the copy it
ships. A change to any file above belongs in both apps in the same change, and
`pnpm check:shared` fails when the copies differ (it skips when the sibling
repo is not checked out, so a standalone clone still builds).

## Screens

| Route         | What it is                                                      |
| ------------- | --------------------------------------------------------------- |
| `/`           | My work — assigned to me, plus my department's unclaimed queue   |
| `/tasks`      | Full list; server-side filters live in the URL, paging is keyset; queue chips carry server totals; optional group-by-source lanes, most urgent lane first |
| `/tasks/[id]` | Detail: room-first header, claim (pool-aware), assign, return, delegate, helpers, submit / review (with the other pending reviews), move, comment, attach & upload |
| `/tasks/new`  | Raise a task, with a live preview off the API's own resolver     |
| `/board`      | Board view of the property's columns                            |
| `/offers`     | Delegation offers waiting on my accept or decline               |
| `/profile`    | Identity, property switch, theme, sign out                       |
| `/login`      | The only public route                                            |

Every role uses this app. Individual actions appear or not via `useCaps()` —
notably `createTask`, a per-account claim plain staff need before they may
raise work at all.

## What the contract dictates (and this app honors)

- **[DR-15] visibility.** Plain staff see their own claimed work plus their
  department's unclaimed queue (pool rows included) — never a colleague's
  claimed tasks. An explicit `assignedStaffId` filter is *clamped* to their own
  id, and an out-of-scope task detail is the same 404 a missing one gets.
- **Claim never steals; assign is the hand-over.** A pool task (TEAM or
  DEPARTMENT) is claimable by its members only; department sync refuses
  cross-department claims/assigns except by an admin.
- **SLA clocks chain and accumulate.** `resolutionDueAt` is open-hours minutes
  from `responseDueAt` (not from activation); `resolutionDuration` accumulates
  time spent IN_PROGRESS; the resolution verdict stamps at submission and is
  never re-judged by review latency.
- **SUBMITTED is frozen** for staff; a leader may only park or cancel it —
  review is the deciding action, leader-of-the-department or admin.
- **No free-text search and no department filter on the list.** The search box
  filters the *loaded* rows and says so; the chips map 1:1 to real parameters.
- **Checklists are write-only.** The API persists checklist rows at creation
  and returns the labels only in the preview — there is no read endpoint, so
  the task detail deliberately shows none.
- **Attachments**: the detail carries non-removed rows only (a removed one is
  gone, not restorable from here); `filepath` may be `""` — preview
  unavailable; uploads are presigned with per-type size caps and the storage
  key's extension comes from the content type, never the filename.
- **A helper's directory is leaders-only.** `GET /v1/staff/assignable` refuses
  plain staff, so the delegate/helper pickers degrade to the caller's own
  teams' member ids, labeled as such.

## Auth

`POST /v1/auth/staff/login?delivery=cookie` sets the `st_session` cookie
(12-hour shift window) and returns the CSRF token the app echoes as
`X-CSRF-Token` on every mutation; `GET /v1/auth/session` recovers the token
after a refresh. Sign-out clears everything on the device, including the
selected property — correct for a shared shift device, and the profile screen
says so.

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
- **The mock's timezone math uses a fixed offset map** (Asia/Jakarta,
  Asia/Makassar) rather than a tz database — honest enough for the demo's
  schedule-aware SLA deadlines, and pinned by tests either way.
