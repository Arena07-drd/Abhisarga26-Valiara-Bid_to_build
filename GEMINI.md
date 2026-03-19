You are a senior full-stack engineer tasked with building a complete web application for a finance event called “Bid to Build”.

Your goal is to build a fully functional, bug-free, minimal UI web platform using:

Frontend:

* HTML
* CSS
* Bootstrap
* Tailwind CSS
* EJS (templating engine)

Backend:

* Node.js
* Express.js

Database:

* SQL (MySQL or PostgreSQL)

The system must support ~100 concurrent teams, authentication, admin controls, auction management, allocation system, and scoring engine.

---

## SECTION 1: CORE CONCEPT UNDERSTANDING

This is a multi-phase event platform.

PHASE 1: TEAM LOGIN + VIEW COMPANIES
PHASE 2: LIVE AUCTION (manual, admin-controlled)
PHASE 3: PORTFOLIO ALLOCATION
PHASE 4: SCORING BASED ON FUTURE DATA
PHASE 5: LEADERBOARD DISPLAY

IMPORTANT:

* Auction is NOT automated.
* Admin manually assigns company to team and price.
* System automatically deducts purse.

---

## SECTION 2: USER ROLES

1. ADMIN

* Full control
* Add companies
* Upload PDFs
* Assign companies to teams
* Start/stop phases
* Trigger scoring

2. TEAM USER

* Login
* Create team (team name)
* View companies
* View owned companies
* Allocate funds
* View leaderboard

---

## SECTION 3: DATABASE DESIGN (SQL)

Create the following tables:

1. users

* id (PK)
* username
* password (hashed)
* role (admin/team)
* created_at

2. teams

* id (PK)
* team_name
* user_id (FK -> users)
* purse_remaining
* created_at

3. companies

* id (PK)
* name
* description (optional)
* pdf_url
* created_at

4. bids (auction results)

* id (PK)
* team_id (FK)
* company_id (FK)
* bid_amount
* assigned_at

5. allocations

* id (PK)
* team_id
* company_id
* allocated_amount

6. company_results (END DATA)

* id (PK)
* company_id
* stock_price
* revenue
* yoy_growth
* ebitda
* market_cap
* market_share

7. scores

* id (PK)
* team_id
* total_score

---

## SECTION 4: AUTHENTICATION SYSTEM

* Use express-session or JWT (session preferred for simplicity)
* Password hashing using bcrypt
* Admin creates users manually
* Team user logs in → creates team

ROUTES:
POST /login
POST /logout
POST /create-team

---

## SECTION 5: ADMIN PANEL FEATURES

ADMIN DASHBOARD MUST INCLUDE:

1. Company Management

* Add company
* Upload PDF
* View all companies

2. Auction Panel

* Dropdown: select team
* Dropdown: select company
* Input: bid amount
* Button: "Assign Company"

WHEN CLICKED:

* Insert into bids table
* Deduct amount from team purse
* Prevent duplicate assignment

3. Phase Control

* Phase states:

  * "auction"
  * "allocation"
  * "closed"
* Store in DB or config table

4. Upload End Data

* Admin inputs company_results manually

5. Trigger Scoring Button

---

## SECTION 6: TEAM DASHBOARD

DISPLAY:

1. Purse Remaining
2. Owned Companies
3. Company List with PDF links
4. Current Phase Status

---

## SECTION 7: AUCTION LOGIC

When admin assigns company:

CHECK:

* Company not already assigned
* Team has enough purse

THEN:

* Deduct purse
* Record bid
* Update UI

---

## SECTION 8: ALLOCATION SYSTEM

WHEN PHASE = allocation:

Team must:

* Allocate FULL amount (e.g., 100k)
* Across owned companies ONLY

VALIDATIONS:

* Total allocation == fixed amount
* No negative values
* Cannot allocate to unowned companies

STORE in allocations table

---

## SECTION 9: SCORING ENGINE

For each team:

For each company they own:

Score formula:

score_per_company =
allocated_amount *
(
stock_price +
revenue +
yoy_growth +
ebitda +
market_cap +
market_share
)

(All weights = 1 for now)

Total score = sum of all company scores

Store in scores table

---

## SECTION 10: LEADERBOARD

Display:

* Rank
* Team Name
* Total Score

Sorted DESC

---

## SECTION 11: FRONTEND PAGES (EJS)

Create:

1. login.ejs
2. team_dashboard.ejs
3. admin_dashboard.ejs
4. allocation.ejs
5. leaderboard.ejs

Use:

* Bootstrap for layout
* Tailwind for quick styling

Keep UI minimal but clean.

---

## SECTION 12: POLLING SYSTEM

Use setInterval (5–10 sec):

* Fetch updates:

  * purse
  * owned companies
  * phase status

API:
GET /api/team-status

---

## SECTION 13: API ROUTES

Auth:
POST /login
POST /logout

Admin:
POST /admin/add-company
POST /admin/assign-bid
POST /admin/set-phase
POST /admin/add-results
POST /admin/calculate-scores

Team:
GET /team/dashboard
POST /team/allocate
GET /team/companies

General:
GET /leaderboard
GET /api/team-status

---

## SECTION 14: VALIDATIONS

* Prevent duplicate company ownership
* Prevent overspending
* Ensure allocation sum correctness
* Ensure scoring runs once

---

## SECTION 15: ERROR HANDLING

* Show user-friendly messages
* Backend try-catch everywhere
* Validate all inputs

---

## SECTION 16: PERFORMANCE

* Handle 100 teams
* Use indexed queries
* Avoid blocking code

---

## SECTION 17: SECURITY

* Hash passwords
* Session protection
* Role-based access

---

## SECTION 18: EXTRA (OPTIONAL)

* Add timer display
* Add simple charts (optional)

---

## FINAL INSTRUCTION

Build the complete project with:

* Proper folder structure
* Fully working backend
* EJS templates
* SQL schema
* No missing functionality

Ensure the system runs with:
npm install
npm start

No placeholders. Everything must work end-to-end.
