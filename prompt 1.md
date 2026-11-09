LOOPLOCAL
FBLA Website Coding & Development — AI Coding Agent Project Brief

Competition: FBLA 2026–2027 Website Coding & Development
Project: Digital Resource Management Website
Product: LoopLocal — Intelligent Organizational Resource-Sharing Network
Primary objective: Build a polished, fully functional, original website that demonstrates advanced development skills and addresses a real-world organizational need.

PAGE 1 — PROJECT REQUIREMENTS & DESIGN
1. Project Overview

Build LoopLocal, a web application that allows school departments, clubs, and nonprofit organizations to share surplus resources, fulfill requests, coordinate transfers, and track the impact of resource reuse.

Organizations frequently purchase supplies that other organizations already possess. LoopLocal addresses this problem through a centralized resource-sharing platform.

Core value proposition: Help organizations find what they need without unnecessarily purchasing new supplies.

The website must be coded from scratch. Do not use website templates or prebuilt website builders.

2. Technology Stack

Use the following recommended technologies:

Frontend: HTML5, CSS3, JavaScript.
Backend: Node.js and Express.
Database: SQLite.
Charts: Chart.js, if useful.
Version control: Git.

Keep frontend components, backend routes, database operations, and business logic organized separately.

Suggested structure:

text
looplocal/
├── public/
│   ├── index.html
│   ├── resources.html
│   ├── requests.html
│   ├── matches.html
│   ├── admin.html
│   ├── css/
│   ├── js/
│   └── images/
├── routes/
├── services/
│   ├── matching.js
│   └── reservations.js
├── database/
│   ├── schema.sql
│   └── seed.js
├── server.js
├── package.json
└── README.md

3. Required Website Pages

A. Dashboard

Display:

Available resources.
Outstanding requests.
Pending approvals.
Completed transfers.
Estimated money saved through reuse.
Recommended resource matches.

All dashboard statistics must be calculated from database records.

B. Resource Exchange

Users must be able to:

Browse available resources.
Search by name.
Filter by category.
Sort listings.
View quantities, condition, location, and photographs.
Open individual resource details.

C. Add a Resource

Allow authorized users to publish resources with:

Name and description.
Category.
Available quantity.
Condition.
Location.
Estimated replacement value.
Availability dates.
Photograph.
Compatible substitute tags.

Validate every submission.

D. Submit a Request

Allow organizations to specify:

Resource needed.
Quantity.
Intended use.
Required date.
Pickup constraints.
Whether substitutes are acceptable.

Requests must be saved to the database.

E. Match Results

Display recommended resources, quantities, supplying organizations, and pickup details.

Users must be able to review proposed fulfillment plans and submit them for approval.

F. Administration and Analytics

Provide administrative functionality for:

Reviewing listings.
Approving requests.
Approving transfers.
Managing inventory.
Resolving conflicts.
Viewing completed transactions.
Reviewing resource demand and impact statistics.
4. Signature Feature: Resource Rescue Engine

This is the website's most important differentiator.

Do not build a generic inventory website. Build an explainable resource-matching system.

Example:

An organization requests 40 reusable containers.

The database contains:

Science Department: 20 containers.
Environmental Club: 12 containers.
Art Department: 15 compatible substitutes.

The system should:

Search eligible resources.
Check category and specification compatibility.
Check available quantities.
Check deadlines and pickup feasibility.
Combine resources from multiple organizations.
Generate a proposed fulfillment plan.
Explain why each resource was recommended.
Allow the requester to submit the plan for approval.

Use a deterministic matching algorithm with documented rules. Do not falsely describe a rules-based algorithm as artificial intelligence.

Implement hard eligibility constraints before ranking matches.

Critical requirement: Prevent two requests from reserving the same inventory. Validate quantities on the server and use database transactions for reservations.

5. Secondary Signature Feature: Impact Ledger

After a transfer is completed, automatically record:

Resources transferred.
Quantity.
Supplying organization.
Receiving organization.
Completion date.
Estimated replacement cost avoided.

Calculate estimated savings using recorded replacement values.

Only completed transfers should count toward completed impact statistics. Label estimates clearly.

PAGE 2 — DEVELOPMENT INSTRUCTIONS & COMPETITION READINESS
6. Database Requirements

Create relational database tables for:

users — accounts and permissions.
organizations — participating organizations.
resources — resource listings and inventory.
resource_images — uploaded image