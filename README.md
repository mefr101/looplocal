# LoopLocal

A resource-sharing tool for the **departments, clubs, and teams inside one organization** (a school or nonprofit). Units list surplus supplies, request what they need, and the **Resource Rescue Engine** proposes an explainable fulfillment plan that can combine stock from several units. Completed transfers feed an **Impact Ledger** of estimated money saved.

Each organization is a private workspace: nothing is visible across organizations.

Built from scratch (no templates) for the FBLA Website Coding & Development event.

## Run it

Requires Node.js 22.5 or newer.

```bash
npm install
npm run reset    # build the database and load demo data
npm start        # http://localhost:3000
```

The demo has **two separate organizations** so you can see that they never mix. Every demo account uses the password `looplocal123`.

| Organization | Join code | Admin | Other accounts |
|---|---|---|---|
| Maple Ridge High School (school; requests go live; plans over $200 need approval) | `MAPLE826` | `admin@mapleridge.example` | `science@`, `green@` (manages Environmental Club, member of Science), `art@`, `robotics@` (plain member), `culinary@`, `council@` (all `@mapleridge.example`) |
| Riverside Community Pantry (nonprofit; requests wait for admin review; own category list) | `PANTRY26` | `admin@riverside.example` | `food@`, `youth@` (two units) (both `@riverside.example`) |

## How the model works

- **Organization** > **units** (departments, clubs, teams, programs) > **people**. Listings and requests belong to a unit.
- A person can belong to **several units**. In each unit they are a *member* or a *manager*.
- Roles: **org admin** (runs the organization, can act for any unit), **unit manager** (manages their unit's listings and requests), **member** (browses, lists resources and makes requests for their units). Anyone can list under any unit they belong to.
- **Joining:** each organization has a join code (admins can regenerate it). Signing up with it makes you a member of the units you choose. Anyone can also create a new organization and becomes its first admin. Organization names are never listed publicly.
- **Isolation:** every query is limited to the signed-in person's organization, and database triggers refuse any row that links two organizations. A person's role and units are reloaded on every request, so an admin's changes apply immediately.
- **Visibility inside an organization:** admins see every request; everyone else sees requests from their own units.

## Project layout

| Folder | Purpose |
|---|---|
| `public/` | Front end: HTML pages, `css/`, `js/`, `fonts/`, `images/` |
| `routes/` | HTTP only: read the request, call a service, send JSON |
| `services/` | Business logic: `settings.js`, `requests.js`, `organizations.js`, `accounts.js`, `permissions.js`, `matching.js`, `reservations.js`, `impact.js`, `validation.js`, `tags.js` |
| `database/` | `schema.sql`, `db.js` (connection + transactions), `seed.js` |
| `middleware/` | Sign-in, role checks, and rate limiting |
| `test/` | Automated tests, run with `npm test` |
| `tools/` | `sync-layout.mjs` and the shared header/footer partials |
| `config.js` | All settings, read from environment variables |

## Request lifecycle

| Status | Meaning |
|---|---|
| `pending_review` | Waiting for an org admin (only when the organization turned on request review) |
| `rejected` | An admin declined it and left a reason |
| `open` | Live; the Rescue Engine can match it |
| `pending_approval` | A fulfillment plan was submitted and awaits an admin |
| `approved` / `fulfilled` | Plan approved / all transfers completed |
| `cancelled` | Withdrawn by the requester |

Admins' own requests skip review. Requesters can edit while a request is `pending_review` or `open`, and cancel until a plan is approved; cancelling a request with a submitted plan releases the stock that plan reserved. Item names become matching tags via `services/tags.js` (`"Reusable Containers"` becomes `reusable-container`). A request chooses **pickup** (the requester collects) or **delivery** (to a campus location), says when its unit is available, and can allow substitutes and partial plans.

## Per-organization settings

Admins edit these on **`settings.html`** (linked from the admin page). It has five tabs:

- **Branding:** organization name, accent color, and logo. The color picker shows a live preview with contrast ratios (text on the color needs 4.5:1, the color against the page needs 3:1); button text switches between dark and white automatically. The preview warns but does not block. Logos are PNG, JPG, or WebP up to 1 MB, checked by their actual file bytes, never by name.
- **Categories** and **Locations:** add, rename, delete. Anything in use can be renamed but not deleted.
- **Pickup hours:** each unit's default days, hours, and storage location (listings start with these; a listing can override them).
- **Approvals:** request review on/off, listing review on/off (default on; admins' own listings skip it), and plan approval `always` / `threshold` / `never`. The threshold compares to the plan's total estimated replacement value. Turning review off leaves waiting requests where they are, and a new plan rule applies only to plans submitted afterward.

API: `/api/admin/settings/...` (`routes/settings.js`, logic in `services/settings.js`). Run the tests with `npm test`.

## Adding a resource

Anyone in at least one unit (and admins) can list under any unit they belong to; the server checks membership. The form is `multipart/form-data` with a JSON `data` field and an optional `photo` file (PNG, JPG, or WebP up to 5 MB, identified by its bytes, with required alt text). Listings wait in `pending_review` when the organization's **review listings** setting is on (the default); admins' own listings skip review. Item name becomes the identity tag, and "can stand in for" entries become substitute tags, which the Rescue Engine will use.

API: `GET /api/resources/context` (what the form needs) and `POST /api/resources`.

## Security notes

- Passwords are hashed with bcrypt. Sessions use an `httpOnly` cookie, regenerated at sign-in.
- Sign-in and join-code guessing is rate limited, and **only failed attempts count** (a whole class at one school IP can sign in without being blocked): 8 wrong passwords per IP+email, 15 wrong join codes per IP, per 15 minutes. Set `RATE_LIMIT_DISABLED=1` only for automated tests.
- Page redirects only guide people; the real protection is on the server (`requireLogin`, `requireAdmin`, `requirePublisher`, and organization scoping in every query).

## Updating the database

There is no migration tool. When `database/schema.sql` changes, bump `SCHEMA_VERSION` in `database/db.js` and run `npm run reset`, which rebuilds the tables and reloads the demo data. If the server says the database is out of date, that is the fix. **It deletes all existing data**, including accounts created through the sign-up page.

## Pages and access

| Page | Who can open it |
|---|---|
| `index.html` (home), `sources.html`, `login.html`, `register.html` | Everyone |
| `dashboard.html`, `resources.html`, `requests.html`, `matches.html`, `account.html` | Signed-in people (their own organization's data only) |
| `add-resource.html` | Anyone in a unit, and admins |
| `admin.html` | Org admins |

A page opts in with `<body data-requires="signedIn | publisher | admin">`, and `layout.js` redirects visitors who don't qualify. The home page shows only platform-wide totals from `/api/stats/public` (no organization named).

Placeholders to replace on the home page (each has an instruction comment in `index.html`): the hero photo, the participating-organization logos, and the review cards. Use real feedback and photos only, and credit them on `sources.html`.

## Changing the look

Edit **`public/css/tokens.css`**. It holds every color, font, size, and spacing value in labeled sections, and the rest of the CSS reads from it. `base.css` and `components.css` are also divided into numbered sections with a table of contents at the top.

## Changing the header or footer

The header and footer are written into every page's HTML, so they show even if JavaScript fails. To change them, edit **`tools/partials/header.html`** or **`footer.html`** and run `npm run sync-layout`. It copies the new version into every page between the `HEADER:START/END` and `FOOTER:START/END` comment markers. A new page only needs those marker pairs. `public/js/layout.js` then handles the parts that depend on who is signed in.

## Deploying

Settings come from environment variables (see `.env.example` for local use and `.env.production.example` for a server). SQLite and uploaded photos need a **persistent disk**: point `DB_PATH` and `UPLOAD_DIR` at it.

The repo includes a production setup: a `Dockerfile` (non-root user, health check, works on x86 and Arm), `docker-compose.yml` and a `Caddyfile` (the app behind Caddy, which gets a free HTTPS certificate), `deploy/backup.mjs` (a safe daily copy of the database and photos) and `deploy/setup-vm.sh`. The full walkthrough for a free Oracle Cloud server is in **`deploy/ORACLE.md`**. Set `SESSION_SECRET` in production; the server refuses to start without it. Behind a proxy the app trusts one hop (`TRUST_PROXY`, default 1 in production), which the secure sign-in cookie needs.

## Roadmap

1. **Foundation** (done): organizations, units, roles, join codes, create-your-organization, org-scoped data, admin people and units screen, request review queue.
2. **Organization settings** (done): categories, locations and unit default hours, approval rules, name and logo and accent color.
3. **Rescue Engine** (done): `services/matching.js` builds the plan, `services/reservations.js` submits it, and the Matches page shows it. Substitutes only fill a shortfall and the requester ticks which to include; partial plans only when the request allows them; a collapsed "Why not these?" list; if the plan changed between viewing and submitting, nothing is reserved and the updated plan is shown for confirmation; pickup/delivery windows must overlap; plan approval follows the organization's setting.
4. **Add a Resource** (done): `add-resource.html`, `POST /api/resources` (`services/resources.js`): validation, one optional photo checked by its real bytes, pickup hours that start from the unit's defaults, and the org's listing-review rule.

5. **Admin queues** (done): `admin.html` shows requests, submitted plans, new listings and conflicts waiting on an admin. Approving a plan schedules its transfers; rejecting one (reason required) releases the stock and reopens the request. A rejected listing's reason shows in "My listings". Conflicts are raised automatically for partial plans and for duplicate listings in the same unit, and are resolved with a note. API: `/api/admin/plans|listings|conflicts`. Schema v6 (listing review columns): run `npm run reset`.

6. **Transfers and Impact Ledger** (done): approved plans become scheduled hand-offs, listed in the **Hand-offs** section of the Matches page. Either unit or an admin marks one done (the full planned quantity) or cancels it with a reason. Completing lowers stock, writes an Impact Ledger snapshot, and fulfils the request once no line is left scheduled. A cancelled plan with nothing completed releases its stock and reopens the request. The dashboard shows the totals and a "Recently reused" list. API: `/api/transfers`.

7. **Analytics** (done): admins open **`analytics.html`** from the admin page. One chart of estimated savings over time (30 days or 90 days by week, all time by month) from completed transfers only, with summary tiles and the same data as a table. Chart.js is copied into `public/vendor/` (MIT, credited on `sources.html`), so it works offline. API: `GET /api/admin/analytics/savings?range=30|90|all`. The demo data includes six sample hand-offs over the past 80 days so the chart has a shape; they are sample data, not real activity.

8. **Accessibility and responsive pass** (done): in-page dialogs (`public/js/dialog.js`, native `<dialog>`) replace the browser's confirm/prompt; responsive rules for the admin, matches, resources and add-resource pages; Windows High Contrast (`forced-colors`) styles; inline styles moved into CSS utility classes; focus moves to the result message after an admin or settings action. Two checkers: `npm run check:a11y` (HTML structure, labels, alt text, headings, captions, inline styles, banned pop-ups) and `npm run check:contrast` (every text and UI color pair in both themes). `npm run check` runs both plus the tests.

### Browser checklist (do this before judging; the scripts cannot see rendered pages)
1. Open each page at **320px** and **375px** wide (DevTools device toolbar): no sideways page scroll, nothing cut off, buttons at least 44px tall.
2. Tab through each page with the keyboard only: a visible focus ring everywhere, a sensible order, no trap. In dialogs Tab stays inside, Escape closes, and focus returns to the button you used.
3. Toggle dark mode and look at badges, the chart and dialogs.
4. Turn on a Windows contrast theme: buttons, badges, the chart and focus rings stay visible.
5. Zoom to **200%** and then **400%**: content reflows, nothing overlaps.
6. Run Lighthouse (Accessibility only) on every page; aim for 100 and note any item it lists.
7. Try a screen reader (NVDA or Narrator) on the request form, the admin queue and a dialog: errors and results are announced.

## Code style

Every curly brace sits on its own line (JavaScript and CSS), and `div`, `li`, `ol`, `tr` and `td` tags each start their own line in the HTML and in the HTML written inside scripts. Inline tags such as `span` and `a` stay inside their sentence so spacing doesn't change. `npm run sync-layout` rewrites the header and footer in its own indentation, so reformat the pages after running it.

## Rules the engine follows

Documented at the top of `services/matching.js`. The engine is deterministic and rules-based, not artificial intelligence, and it only reads the database.

1. **Filter:** same organization, approved, in stock, a different unit, the right item (identity tag, or a substitute tag when the request accepts substitutes), dates that overlap today through the needed-by date, and a shared weekday and time window.
2. **Rank:** exact before substitute, then better condition, then larger stock, then lowest id.
3. **Combine:** take from exact matches in order; substitutes are only *suggested* for a shortfall and used only if ticked; a partial plan can be submitted only if the request allows it.
4. **Explain:** every line says why it was chosen and gives the first hand-off date and time; excluded look-alike listings get a plain-English reason.

Submitting (`POST /api/matches/:requestId/submit`) recomputes the plan inside one database transaction. If its `signature` differs from the one the requester saw, nothing is reserved and the new plan comes back (HTTP 409). Otherwise stock is reserved all-or-nothing and the plan goes to an admin or is approved automatically, per the organization's plan-approval rule (`always`, `threshold` by total replacement value, or `never`). Approved plans get a scheduled transfer per line.

API: `GET /api/matches/:requestId?substitutes=1,2` and `POST /api/matches/:requestId/submit`. The demo data includes the homepage example (Student Council asks for 40 reusable containers), a partial plan (Art asks for 10 laptops, 6 exist), and a request with nothing available.
