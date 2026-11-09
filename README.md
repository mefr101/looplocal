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
- Roles: **org admin** (runs the organization, can act for any unit), **unit manager** (publishes and manages their unit's listings), **member** (browses and makes requests for their units).
- **Joining:** each organization has a join code (admins can regenerate it). Signing up with it makes you a member of the units you choose. Anyone can also create a new organization and becomes its first admin. Organization names are never listed publicly.
- **Isolation:** every query is limited to the signed-in person's organization, and database triggers refuse any row that links two organizations. A person's role and units are reloaded on every request, so an admin's changes apply immediately.
- **Visibility inside an organization:** admins see every request; everyone else sees requests from their own units.

## Project layout

| Folder | Purpose |
|---|---|
| `public/` | Front end: HTML pages, `css/`, `js/`, `fonts/`, `images/` |
| `routes/` | HTTP only: read the request, call a service, send JSON |
| `services/` | Business logic: `requests.js`, `organizations.js`, `accounts.js`, `permissions.js`, `matching.js`, `reservations.js`, `impact.js`, `validation.js`, `tags.js` |
| `database/` | `schema.sql`, `db.js` (connection + transactions), `seed.js` |
| `middleware/` | Sign-in, role checks, and rate limiting |
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

Stored on each organization: `review_requests`, `plan_approval_mode` (`always` / `threshold` / `never`) with a threshold amount, `brand_color`, `logo_filename`, plus its own categories, locations, and each unit's default pickup days and hours. The admin screen for editing these is the next build step; request review already follows the setting.

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
| `add-resource.html` | Unit managers and admins |
| `admin.html` | Org admins |

A page opts in with `<body data-requires="signedIn | publisher | admin">`, and `layout.js` redirects visitors who don't qualify. The home page shows only platform-wide totals from `/api/stats/public` (no organization named).

Placeholders to replace on the home page (each has an instruction comment in `index.html`): the hero photo, the participating-organization logos, and the review cards. Use real feedback and photos only, and credit them on `sources.html`.

## Changing the look

Edit **`public/css/tokens.css`**. It holds every color, font, size, and spacing value in labeled sections, and the rest of the CSS reads from it. `base.css` and `components.css` are also divided into numbered sections with a table of contents at the top.

## Changing the header or footer

The header and footer are written into every page's HTML, so they show even if JavaScript fails. To change them, edit **`tools/partials/header.html`** or **`footer.html`** and run `npm run sync-layout`. It copies the new version into every page between the `HEADER:START/END` and `FOOTER:START/END` comment markers. A new page only needs those marker pairs. `public/js/layout.js` then handles the parts that depend on who is signed in.

## Deploying

Settings come from environment variables (see `.env.example`). SQLite and uploaded photos need a **persistent disk**: point `DB_PATH` and `UPLOAD_DIR` at it. A `Dockerfile` and a `/health` route are included. Set `SESSION_SECRET` in production, and replace the default in-memory session store first.

## Roadmap

1. **Foundation** (done): organizations, units, roles, join codes, create-your-organization, org-scoped data, admin people and units screen, request review queue.
2. **Organization settings** (next): categories, locations and unit default hours, approval rules, name and logo and accent color.
3. **Rescue Engine** (after that): `services/matching.js` and the Matches plan view, with these decisions already made: substitutes only fill a shortfall and the requester ticks which suggested ones to include; partial plans only when the request allows them; a collapsed "Why not these?" list; if the plan changed between viewing and submitting, nothing is submitted and the updated plan is shown for confirmation; pickup/delivery windows must overlap; plan approval follows the organization's setting.
4. Add a Resource (validation, photo upload, pickup hours), reservations and transfers, admin queues for listings and plans, Impact Ledger writes, charts, an accessibility and responsive pass, and tests.

## Rules the engine follows

Documented at the top of `services/matching.js` (being updated for the intra-organization model in step 3). The engine is deterministic and rules-based, not artificial intelligence.
