# Smart University Portal

A student portal for Metropolitan University, Sylhet: Google Classroom coursework, fee invoices paid with Stripe, official results, an AI study assistant, campus bus tracking and notices, in one place.

**Live:** [metsol-nu.vercel.app](https://metsol-nu.vercel.app) · API: [metsol-api.vercel.app](https://metsol-api.vercel.app/api/health)

> Payments run in **Stripe test mode**. No real money moves; use the test card `4242 4242 4242 4242`.

---

## Features

| Area | What it does | Data |
|---|---|---|
| **Google Classroom** | Students connect their Google account once and see every assignment and lab task: Missing, To do, No due date and Turned in, with filters and a "Next in Google Classroom" dashboard card. **Submit in Classroom** opens the student's own submission page. | Live from Google (read-only) |
| **Payments** | Students see their fee invoices and pay on Stripe's hosted Checkout page. Admins create invoices. Every active student is billed **৳5,000 on the 1st of each month**, due on the 10th. | Live (PostgreSQL + Stripe) |
| **Dashboard** | Greeting, Due Payment total, the next Classroom deadlines and recent notices. | Live, apart from the Courses / Assignments / Attendance tiles |
| **Results** | Official results matched to the logged-in student's ID. Admins import a university result PDF (previewed first, with duplicates rejected) and can use a CGPA calculator. | Live |
| **AI Assistant (EduAI)** | Chat, plus summaries and Q&A over uploaded PDF, DOCX or TXT files (up to 10 MB). Uses Groq, and gives a labelled demo reply without a key. | Live |
| **Bus Tracking** | 3D campus map with official routes, stops and buses. It shows the nearest bus and whether you'll reach class on time. Positions are **estimated from the timetable** (there's no GPS). Transport admins manage routes, stops, buses, schedule PDFs and notices. | Live |
| **Notices** | University and transport notices, plus the current bus schedule PDF. | Live |
| **Courses, Teachers, Assignments, Attendance** | Course cards, teacher directory, assignment cover-page generator (print to PDF) and attendance summary. | Demo content |
| Account | Supabase email sign-up with a student academic profile, password reset, light/dark theme, Ctrl+K page search. | Live |

Roles: **STUDENT** (default for every new sign-up), **TEACHER**, **ADMIN** and **TRANSPORT_ADMIN**.

---

## Tech stack

- **Frontend:** React 19 and Vite 7, MapLibre GL and Leaflet maps, Supabase JS for sign-in
- **Backend:** Node.js and Express, Prisma ORM, Helmet, rate limiting, Zod
- **Database and auth:** PostgreSQL on Supabase, Supabase Auth (email confirmation required)
- **Integrations:** Google Classroom API (OAuth 2.0), Stripe Checkout and webhooks, Groq (AI), OSRM and Nominatim (routing and geocoding)
- **Hosting:** Vercel, with two projects (frontend and backend) and a monthly Vercel Schedule

```
smart-university-portal/
├── frontend/          React app (Vite)
│   ├── src/           main.jsx, GoogleClassroom.jsx, Payments.jsx, Transport.jsx, LiveBusMap.jsx …
│   └── public/        Static files, including privacy.html (used by the Google consent screen)
├── backend/           Express API
│   ├── src/           server.js, googleClassroom.js, classroomCoursework.js, stripePayments.js,
│   │                  monthlyInvoices.js, transportRoutes.js, ai.js, result-import/ …
│   ├── prisma/        schema.prisma, migrations, seed scripts
│   ├── test/          node:test suites
│   └── vercel.json    Monthly invoice schedule
├── shared/            Grading rules shared by the frontend and backend
└── docs/              SRS, project proposal, UI design notes
```

---

## Run it locally

**Requirements:** Node.js 20 or later (developed on Node 24), npm, and a [Supabase](https://supabase.com) project (free tier is fine).

### 1. Configure

```bash
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env
```

Fill in at least these values. The full list is under [Environment variables](#environment-variables).

| File | Required |
|---|---|
| `backend/.env` | `DATABASE_URL`, `DIRECT_URL`, `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `JWT_SECRET` |
| `frontend/.env` | `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` |

To generate a random secret:

```bash
node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"
```

### 2. Database

```bash
cd backend
npm ci
npx prisma migrate deploy   # creates every table
npm run seed                # optional: demo users, courses, notices and two demo invoices
```

Use `migrate deploy`, not `migrate dev`, against Supabase.

### 3. Start

```bash
# terminal 1
cd backend && npm run dev        # http://localhost:4000

# terminal 2
cd frontend && npm ci && npm run dev   # http://localhost:5173
```

The Vite dev server proxies `/api` to `http://localhost:4000`, so leave `VITE_API_URL` empty locally.

### 4. Sign in

Sign up in the app with your email and confirm it. New accounts are students. To make someone a teacher or admin, change `role` on their row in the Supabase **Table Editor → User** table.

The seeded accounts (`admin@university.test`, `teacher@university.test`, `student@university.test`) are linked the first time someone signs up and confirms that email. Their old seed passwords don't work, because Supabase handles all passwords.

---

## Environment variables

### Backend (`backend/.env`)

| Variable | Needed for | Notes |
|---|---|---|
| `DATABASE_URL` | Everything | Supabase transaction pooler (port 6543), with `?pgbouncer=true&connection_limit=1` added |
| `DIRECT_URL` | Migrations | Supabase session pooler or direct connection (port 5432) |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | Sign-in | Supabase → Project Settings → API |
| `SUPABASE_SERVICE_ROLE_KEY` | Transport admins | Backend only. Needed to create transport admin accounts from the UI |
| `JWT_SECRET` | Google OAuth | Signs the short-lived OAuth state value. Use 32+ random characters |
| `FRONTEND_URL` | CORS, redirects | e.g. `https://metsol-nu.vercel.app`, with no trailing slash |
| `PORT` | Local | Defaults to `4000` |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Google Classroom | From the OAuth client (see below) |
| `GOOGLE_REDIRECT_URI` | Google Classroom | `<backend URL>/api/google/classroom/callback` |
| `GOOGLE_OAUTH_ENCRYPTION_KEY` | Google Classroom | 32+ random characters. Encrypts stored Google tokens |
| `STRIPE_SECRET_KEY` | Payments | **Test keys only** (`sk_test_`, `rk_test_` or `rkcs_test_`). Live keys are rejected |
| `STRIPE_WEBHOOK_SECRET` | Payments | `whsec_…` signing secret of the Stripe webhook endpoint |
| `CRON_SECRET` | Monthly invoices | 16+ random characters. Vercel sends it to the schedule route |
| `GROQ_API_KEY`, `GROQ_MODEL` | AI Assistant | Optional. The model defaults to `openai/gpt-oss-20b` |
| `OSRM_ROUTING_URL`, `NOMINATIM_URL`, `NOMINATIM_USER_AGENT` | Transport | Optional road routing and geocoding |

### Frontend (`frontend/.env`)

| Variable | Notes |
|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | Same Supabase project as the backend |
| `VITE_API_URL` | Leave empty locally. In production, set the backend's URL with no `/api` (e.g. `https://metsol-api.vercel.app`) |

Never commit `.env` files. They're git-ignored and excluded from Vercel uploads.

---

## Google Classroom

The portal asks for **read-only** access and never submits work. Coursework is fetched live and **not stored**; only the Google tokens are kept, encrypted, in `GoogleAccountConnection`.

**Setup in Google Cloud Console** (no billing is needed, but 2-step verification must be on):

1. Create a project and enable the **Google Classroom API**.
2. In **Google Auth Platform**, choose **External**, set the app name, support email, home page and privacy policy (`/privacy.html` on the frontend), and add the frontend and backend domains as **authorised domains**.
3. Under **Data access**, add the scopes `openid`, `email`, `classroom.courses.readonly`, `classroom.coursework.me.readonly` and `classroom.topics.readonly`. All five are non-sensitive.
4. Under **Clients**, create a **Web application** client. Add a redirect URI for every backend you run, e.g. `http://localhost:4000/api/google/classroom/callback` and `https://metsol-api.vercel.app/api/google/classroom/callback`.
5. Under **Audience**, publish the app. With only non-sensitive scopes, Google doesn't require verification and there's no 100-user cap. In *Testing* mode, only listed test users can connect.

Lab work is any coursework whose Classroom topic or title contains "lab" or "laboratory". Classroom has no separate lab type. University-managed Google accounts may need the Workspace admin to allow the app.

---

## Payments (Stripe)

- **Flow:** the student clicks **Pay with Stripe**, pays on Stripe's hosted Checkout page and returns to the portal, where the invoice is marked **Paid**. Card details never reach this server.
- **Confirmation:** a **signed webhook** (`/api/payments/stripe/webhook`) marks invoices paid. It handles `checkout.session.completed`, `checkout.session.async_payment_succeeded`, `checkout.session.async_payment_failed` and `checkout.session.expired`. When the student returns, the portal also asks Stripe directly as a backup. Both paths check the amount and do nothing the second time.
- **Safety:** a second click reuses the open Checkout session, so one invoice can't be paid twice by accident.
- **Monthly billing:** the Vercel Schedule `monthly-fee-invoices` (`backend/vercel.json`) calls `/api/cron/monthly-invoices` at **00:05 Asia/Dhaka on the 1st** of every month. That route is protected by `CRON_SECRET`. Each active student gets one "Monthly Fee · <Month Year>" invoice of ৳5,000, due on the 10th. The invoice number is unique per student per month, so reruns never double-bill.

**Local testing:** a free test sandbox works fine. `stripe sandboxes create` from the [Stripe CLI](https://docs.stripe.com/stripe-cli) gives you a key without signing up. Put the key in `backend/.env` and pay with `4242 4242 4242 4242`, any future expiry date and any CVC. The webhook isn't needed locally, because the return-page check confirms the payment.

**Production:** add `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET` and `CRON_SECRET` to the backend project on Vercel. Create a Stripe webhook endpoint for the deployed backend with the four events above. Taking real money would need an activated Stripe account in a supported country, plus allowing live keys in `backend/src/stripePayments.js`.

---

## Official results import

Admins upload a university result PDF on the Results page, preview it, then import it.

- **Storage:** PDFs are processed in memory and not kept.
- **Duplicates:** the same file is rejected by its SHA-256 hash. A new release is stored separately, and students see the latest one.
- **Matching:** students' results are matched to the student ID on their own account. The browser never sends a student ID.
- **Supported layout:** the parser is deliberately strict. It needs text-based PDFs with a single-row header (student ID, course code or name, credit, grade or marks). Scanned PDFs are rejected.
- **Test file:** there's a sample at `backend/test-data/sample-result.pdf`.

---

## Tests

```bash
cd backend && npm test                        # 40 tests: Classroom, Stripe, monthly invoices, results, AI, transport
cd frontend && node --test src/busEstimate.test.js   # 9 tests: bus position estimates
```

---

## Deployment (Vercel)

There are two Vercel projects from this one repository, and both deploy automatically on every push to `main`:

| Project | Root directory | Framework |
|---|---|---|
| `metsol` (frontend) | `frontend` | Vite |
| `metsol-api` (backend) | `backend` | Express (`src/server.js`), with **Include files outside root** enabled for `shared/` |

For the step-by-step Supabase and Vercel setup, see [`SUPABASE_VERCEL_SETUP.md`](SUPABASE_VERCEL_SETUP.md). Environment variables live in each project's settings and only take effect after a redeploy.

---

## Security notes

- Every API route needs a confirmed Supabase session. Roles are checked on the server.
- Security headers come from Helmet. CORS only allows `FRONTEND_URL`. Requests are rate-limited, but the limit is per server instance, so it's only a soft limit on Vercel.
- Google tokens are encrypted at rest. The Stripe webhook verifies signatures. The cron route compares its secret in constant time.
- Only Stripe test keys are accepted, so live charges can't happen by mistake.
- Request bodies on Vercel are limited to about 4.5 MB, so very large result PDFs or AI documents may fail there.

## Known limitations

- The Courses, Teachers, Assignments and Attendance pages, and three dashboard tiles, still show demo content.
- Bus positions are estimated from the timetable, not GPS.
- Stripe is test mode only.

## Documentation

- [Software Requirements Specification](docs/SRS.md)
- [Project proposal](docs/PROJECT_PROPOSAL.md)
- [UI design notes](docs/APPROXIMATE_UI_DESIGN.md)
- [Supabase and Vercel setup](SUPABASE_VERCEL_SETUP.md)
- [Privacy policy](https://metsol-nu.vercel.app/privacy.html)
