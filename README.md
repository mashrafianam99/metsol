# Smart University Student Portal

Modern, multilingual university portal starter for Student, Teacher and Admin roles.

## Stack
- Frontend: React + Vite
- Backend: Node.js + Express
- Database: PostgreSQL + Prisma
- Authentication: JWT + bcrypt
- AI: Groq Responses API with demo fallback
- Mobile payments: bKash/Nagad integration-ready adapter (merchant credentials required)

## Requirements
Node.js 20+, npm, PostgreSQL 14+.

## Run locally
1. Install Node.js and PostgreSQL.
2. Open this folder in VS Code.
3. Create `backend/.env` by copying `.env.example` (`Copy-Item .env.example .env` in PowerShell, or `cp .env.example .env` in macOS/Linux), configure the database connection, and replace `JWT_SECRET` with a random value. Generate one with `node -e "console.log(require('node:crypto').randomBytes(32).toString('hex'))"`.
4. In a terminal, install and start the backend:
   ```bash
   cd backend
   npm ci
   npx prisma generate
   npx prisma migrate dev
   npm run seed
   npm run dev
   ```
5. Open a second terminal:
   ```bash
   cd frontend
   npm ci
   npm run dev
   ```
6. Visit http://localhost:5173

The Vite development server proxies `/api` requests to `http://localhost:4000` by default, so login also works when the frontend is opened from another device on the same network. For a separately hosted API, set `VITE_API_URL` in `frontend/.env` to the API server's origin (without `/api`) and set `FRONTEND_URL` in `backend/.env` to the frontend's origin before building/deploying.

Demo login (after seeding):
- Admin: admin@university.test / Admin123!
- Teacher: teacher@university.test / Teacher123!
- Student: student@university.test / Student123!

Students sign up with their name, email, password, student ID, department, batch, and section. These required profile details are saved to the portal account when the confirmed Supabase session is first used and then reused across the portal, including official result lookup and assignment cover pages. Student IDs are normalized and unique; new sign-ups always receive the STUDENT role.

Change demo passwords and JWT_SECRET before deployment.

## University result PDF import
Administrators can preview and import a university result PDF from the Results page. PDFs are processed in backend memory and are not made public or retained. The same PDF is rejected on repeat import by its SHA-256 hash; a different release is stored as a new historical import, and students see records from the latest imported release only.

The current parser is deliberately conservative: it supports text-based PDFs with a single-row table header containing Student ID, course code or course name, credit, and grade or marks columns, with the Student ID present on each course row. It rejects unknown layouts instead of guessing. Scanned/image-only PDFs require an OCR service and are currently rejected with an explicit message. The actual Metropolitan University result PDF layout has not been supplied for parser validation, so administrators should test a representative PDF before relying on imports.

Student results are fetched using the Student ID attached to the authenticated backend account; the endpoint does not accept a student ID from the browser. Admin upload and import routes enforce the ADMIN role server-side. Run backend tests with `npm test` from `backend`.

### Sample result PDF for testing
A ready-to-import sample result file is included at `backend/test-data/sample-result.pdf`. Use it to quickly verify the result upload flow in the admin Results screen before testing with a real university PDF.

## Google Classroom integration status
This branch includes a working backend-and-UI scaffold for Google Classroom connectivity, but the live Google OAuth flow still requires a real Google Cloud OAuth client configuration before it can complete the connection in a browser. The app is structured to keep the existing student portal and JWT auth flow intact while exposing Classroom connect, callback, status, and disconnect routes. The code is intentionally left as a safe integration scaffold until real credentials are added.

## External integrations
- AI: Set `GROQ_API_KEY` in backend/.env and optionally `GROQ_MODEL` (defaults to `openai/gpt-oss-20b`). EduAI uses Groq's OpenAI-compatible Responses API. Without a key, the assistant returns a clearly labelled demo response. Students can upload PDF, DOCX, and TXT files up to 10 MB for summaries and document-grounded Q&A. Documents are extracted in backend memory, limited to 30,000 characters and 100 PDF pages, and are not stored by the portal. Extracted text is sent to Groq when answering questions; scanned PDFs require OCR and are not supported.
- bKash/Nagad: Set merchant credentials and implement/enable the relevant official merchant API credentials and callback URLs. The included payment route creates a PENDING transaction only; it never marks a payment successful without verified gateway confirmation. Never collect or store a user's mobile wallet PIN/OTP.
- Live transport: Add GPS tracker/device feed credentials and configure `TRANSPORT_PROVIDER_URL` / `TRANSPORT_API_KEY`. Until configured, the UI shows sample DEMO vehicle locations, not live tracking.
- Email/SMS/push notifications: configure a provider before production.

## Included modules
Dashboard, teacher directory, courses/registration, results/CGPA, class & exam routine, assignments with individual/group cover-page preview and print-to-PDF, attendance, academic calendar, notices, transcript, EduAI with document summaries and Q&A, study hub, question bank, AI question generation, study planner, progress, notifications, transport, hostel/library information, digital student ID, fee/payment history, student helpdesk, teacher workspace and admin management.

## Production checklist
Configure HTTPS, strong secrets, database backups, rate limiting, CORS allowlist, email verification/password reset, audit logs, gateway signature verification, privacy/retention policy, and real GPS/AI/payment providers. Review authorization rules and institutional requirements before handling real student records.
