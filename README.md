# LoopLocal

A resource-sharing network for school departments, clubs, and nonprofits. Organizations list surplus supplies, request what they need, and the **Resource Rescue Engine** proposes an explainable fulfillment plan that can combine stock from several organizations. Completed transfers feed an **Impact Ledger** of estimated money saved.

Built from scratch (no templates) for the FBLA Website Coding & Development event.

## Run it

Requires Node.js 22.5 or newer.

```bash
npm install
npm run seed     # load demo data (npm run reset wipes and reseeds)
npm start        # http://localhost:3000
```

Demo accounts (password `looplocal123`): `admin@looplocal.example`, `science@looplocal.example`, `pantry@looplocal.example`, and others listed in `database/seed.js`.

## Project layout

| Folder | Purpose |
|---|---|
| `public/` | Front end: HTML pages, `css/`, `js/`, `images/` |
| `routes/` | HTTP only: read the request, call a service, send JSON |
| `services/` | Business logic: `matching.js`, `reservations.js`, `impact.js`, `validation.js` |
| `database/` | `schema.sql`, `db.js` (connection + transactions), `seed.js` |
| `middleware/` | Sign-in and role checks |
| `config.js` | All settings, read from environment variables |

## Pages and access

| Page | Who can open it |
|---|---|
| `index.html` (home), `resources.html`, `sources.html`, `login.html`, `register.html` | Everyone |
| `dashboard.html`, `requests.html`, `matches.html`, `account.html` | Signed-in users |
| `add-resource.html` | Organization managers and admins |
| `admin.html` | Admins |

A page opts in with `<body data-requires="signedIn | publisher | admin">`, and `layout.js` redirects visitors who don't qualify. That only guides people: the real protection is on the server, where private API routes use `requireLogin` / `requireRole`. The home page shows only public totals from `/api/stats/public`.

Placeholders to replace on the home page (each has an instruction comment in `index.html`): the hero photo, the participating-organization logos, and the review cards. Use real feedback and photos only, and credit them on `sources.html`.

## Changing the look

Edit **`public/css/tokens.css`**. It holds every color, font, size, and spacing value in labeled sections, and the rest of the CSS reads from it. `base.css` and `components.css` are also divided into numbered sections with a table of contents at the top.

## Changing the header or footer

The header and footer are written into every page's HTML, so they show even if JavaScript fails. To change them, edit **`tools/partials/header.html`** or **`footer.html`** and run `npm run sync-layout`. It copies the new version into every page between the `HEADER:START/END` and `FOOTER:START/END` comment markers. A new page only needs those marker pairs. `public/js/layout.js` then handles the parts that depend on who is signed in.

## Deploying

Settings come from environment variables (see `.env.example`). SQLite and uploaded photos need a **persistent disk**: point `DB_PATH` and `UPLOAD_DIR` at it. A `Dockerfile` and a `/health` route are included. Set `SESSION_SECRET` in production, and replace the default in-memory session store first.

## Roadmap

- [x] Schema, seed data, auth, resource browsing, dashboard stats
- [ ] Add a Resource (validation + photo upload)
- [ ] Submit a Request
- [ ] Rescue Engine (`services/matching.js`) and the Matches page (proposed plans, plus the organization's own requests and listings)
- [ ] Reservations with transactions (`services/reservations.js`)
- [ ] Admin queues, conflict resolution, transfer completion, Impact Ledger writes
- [ ] Charts (Chart.js, vendored locally so it works offline)
- [ ] Accessibility and responsive pass; sources page content; tests

## Rules the engine follows

Documented at the top of `services/matching.js`. The engine is deterministic and rules-based, not artificial intelligence.
