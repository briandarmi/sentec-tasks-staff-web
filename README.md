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
with no partner connected at all — a property that has never run Butler can
still raise and work internal jobs against Tasks' own catalog.

Background: [`../docs/Sentec-Tasks-Struktur-Aplikasi.md`](../docs/Sentec-Tasks-Struktur-Aplikasi.md)
(architecture, roles, dispatch flow) and [`../docs/sentec-tasks.md`](../docs/sentec-tasks.md)
(staff workspace behaviour and the review findings encoded below).

## Getting started

```bash
pnpm install              # from the workspace root
pnpm dev:tasks-staff      # or: pnpm --filter sentec-tasks-staff-web dev
```

Then sign in with any of the demo accounts listed on the login screen:

| Username   | Password       | Who they are                                        |
| ---------- | -------------- | --------------------------------------------------- |
| `staff`    | `staff123`     | Housekeeping staff, works two properties            |
| `leader`   | `leader123`    | Housekeeping supervisor — can assign                |
| `admin`    | `admin123`     | Property admin — configures the property            |
| `operator` | `operator123`  | Sentinel Tech operator — provisions the platform    |
| `regional` | `regional123`  | Admin at one Aston property, group grant at another  |

The login screen keeps that order and puts a divider after `leader`: the two
frontline roles this workspace is built for sit above it, and the accounts that
are usually here to look at a queue rather than work one sit below.

```bash
pnpm typecheck    # vue-tsc across app + templates, including the shared layer
pnpm build        # static SPA into .output/public
```

`pnpm test` covers the mock API contract and the presentation helpers — 70 tests
over this repo's own copy of both, so a standalone clone verifies itself.

## Kept in step by hand

Eight files are **duplicated** between this app and the admin console, and
nothing enforces that they stay identical:

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

Plus `tests/mock-api.spec.ts` and `tests/task-ui.spec.ts`, which are duplicated
for a reason: each repo tests the copy it ships, so neither can drift silently
into a green suite somewhere else.

This is the deliberate trade for two repositories that build independently —
the same one the Butler consoles make with their own `clientFakeApi.ts`. A change
to any file above belongs in both apps in the same review. `diff -r` between the
two `app/composables` and `app/utils` directories is the cheap check.

## Screens

| Route         | What it is                                                      |
| ------------- | --------------------------------------------------------------- |
| `/`           | My work — assigned to me, plus my department's unclaimed queue   |
| `/tasks`      | Full list, filterable; filters live in the URL, paging is cursor |
| `/tasks/[id]` | Detail: claim, assign, move status, comment, attach              |
| `/tasks/new`  | Raise a task from the catalog                                    |
| `/board`      | Board view of the property's columns                            |
| `/profile`    | Identity, property switch, theme, sign out                      |
| `/login`      | The only public route                                            |

Every role uses this app — including admins and operators, who also work a
queue. There are no role-gated *routes* here; individual actions appear or not
via `useCaps()`. Route gating is the admin console's problem.

## Roles

Per property: `staff` (own department's queue) → `leader` (also assigns) →
`admin` (also configures, in the other app). `operator` is a platform-level flag
on the user, not a property role.

A **group grant** gives read *and write* across every property in a brand. Only
an operator can grant or revoke one — a property admin cannot, including to
themselves — and every change lands in the audit trail.

## Mock API

There is no `sentec-tasks-api` in this workspace, so the app runs against an
in-browser mock:
[`app/utils/clientFakeApi.ts`](app/utils/clientFakeApi.ts).
Same pattern the Butler consoles used before their live API existed. State lives
in memory and resets on reload — and it is one dataset shared with the admin
console, so a property provisioned there is a property this app can reach.

Scope key is `tenantId` — a tenant **is** a property. The product term is
tenant/property because a tenant need not be a hotel; in PostgreSQL this is the
`hotel_id` LIST partition key every main table is partitioned by, so every query
filters on it explicitly rather than sweeping partitions.

Swapping the mock for the real API means replacing the `request()` body in
[`useSession.ts`](app/composables/useSession.ts) with
`$fetch` and a base URL — once, for both apps. Nothing above that line knows the
difference: pages only ever talk to
[`useTasksApi`](app/composables/useTasksApi.ts).

### Behaviour deliberately encoded

The final review of the earlier build turned up three defects that only showed
up when the whole thing was reviewed at once. Each is now pinned by a test in
[`tests/mock-api.spec.ts`](tests/mock-api.spec.ts):

1. **Claim cannot steal an assignment.** There is no `CLAIMED` status — claiming
   creates an *assignment*, and never moves the task's status. Claiming a task
   somebody else holds is refused with `409`; hand-over must go through Assign,
   which is a leader action. Claiming a task you already hold is idempotent, so
   a double-tap on flaky wifi is safe. The UI matches: no Claim button appears on
   a task someone else holds.
2. **Task detail is authorization-checked.** Knowing an id is not authorization.
   Staff read their own assigned work plus their own department's queue; leaders,
   admins and operators read the whole property. Cross-property reads are scoped
   out entirely.
3. **Sign-out forgets everything.** Identity, resume token and every cached
   payload are dropped, so a shared shift device never shows the next person the
   last one's work. That includes the selected property, which is why signing
   back in asks for it again — correct for a shared device, and the profile
   screen says so rather than letting it surprise anyone.

Plus the operational rule changes that went with them:

- **Staff see unclaimed work in their department.** The Butler-era rule hid it
  from exactly the people meant to claim it.
- **The assign picker opens scoped to the task's department**, with a "show
  everyone" toggle for genuine cross-department cover. It also shows how much
  open work each person is already carrying.
- **Task list filters live in the URL**, so a filtered view is shareable and
  survives both a refresh and the back-navigation from a task detail. Paging is
  cursor-based.

## Auth

The real API issues an httpOnly cookie session with CSRF protection and a CORS
allow-list — deliberately not a bearer token in `localStorage`, which any script
on the page can read. The mock keeps that discipline: no user id, role or
permission is persisted, and the only thing held across a refresh is an opaque
resume token in `sessionStorage`, which dies with the browser tab and expires
after a 12-hour shift window.

A browser-side mock cannot create an httpOnly cookie — that is necessarily a
server concern — so what is modelled here is the shape, not the protection.

## Design system

Copied wholesale from the Butler consoles so the apps stay visually one product:
Nuxt 4 SPA (`ssr: false`), shadcn-vue (`new-york`, `neutral` base, Tabler
icons), Tailwind 4 with the same token set, Quicksand, Sentinel Blue
`#27A5F7` primary.
`app/components/ui/` is the unmodified shadcn set. Every status and SLA colour is
a semantic token, never a literal — a test in the core layer asserts that, so
light and dark cannot drift apart.

Mobile-first is the whole point of this app: interactive targets are at least
44px, and the desktop case is handled by capping column width rather than growing
a second pane, so the layout that gets tested on a phone is the one seen on a
laptop.


The colour layer comes from the **Sentinel Tech Design System** on
claude.ai/design: `app/assets/css/tailwind.css` carries the `--st-*` brand scale
verbatim from that project's `tokens/colors.css`, and every shadcn token is
expressed in terms of it. The design system's own `--color-*` / `--text-*` alias
layer is deliberately not imported — those are Tailwind 4's colour and font-size
utility namespaces, which `@theme inline` already claims. Dark mode is derived
from the Sentinel Grey scale because the design system defines none.
## Not verified yet

Stated plainly rather than implied:

- **No browser or component tests.** This environment has no working headless
  browser (Chromium is cached but `libnss3` is missing and installing it needs
  root), and a Nuxt-runtime component environment could not be brought up
  either. Touch-target sizes and screen-reader behaviour were reviewed in CSS,
  not measured in a browser. `pnpm build` and `pnpm typecheck` pass, which
  covers templates and types but not runtime rendering.
- **Attachment upload does not exist.** The API takes a URL to an
  already-hosted file — no multipart, no presigned, no base64 — so the UI asks
  for a URL and says why instead of offering a file picker that would fail.
  Housekeeping cannot photograph damage from a phone yet. Blocked on a storage
  decision (local disk vs S3 vs presigned).
