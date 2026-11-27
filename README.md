# CSC Feed — Project Reports

A responsive frontend skeleton for sharing reports across multiple projects. The interface follows the reference app's compact sidebar, blue-accented controls, cards, and accessible form patterns.

## Run locally

```sh
npm install
```

After installing PostgreSQL and Node.js, run `npm run dev` in an interactive terminal. It checks the API and web ports, starts PostgreSQL if needed, applies the migrations, and starts the app. On first run, it asks for the PostgreSQL administrator password without echo, creates the local `cscfeed` database and dedicated owner/app roles with generated passwords, and saves their connection URLs in the Git-ignored `.env`. The administrator password is not saved. Existing databases are not recreated; recovery of existing dedicated role passwords requires explicit confirmation.

In VS Code, forward port `5173` to open the app; Vite proxies API requests to port `5001`. Forward port `5001` separately only when you need direct access to the API.

If service permissions prevent PostgreSQL from starting, start it from Windows Services and rerun `npm run dev`. The startup checks that API and web ports are free and does not terminate a process that already owns either port. `npm run dev:local` is an alias for `npm run dev`; `npm run dev:stack` runs the API and web processes directly without preflight or database migrations.

To configure an existing database manually, copy `.env.example` to `.env` and set valid `DATABASE_URL` and `MIGRATION_DATABASE_URL` values before running `npm run dev:local`.
If either saved local role password is rejected, `npm run dev:local` offers an interactive recovery using a PostgreSQL administrator login. Confirming it rotates only the `cscfeed_owner` and `cscfeed_app` passwords for the local `cscfeed` database and updates `.env`; it does not modify database contents. Remote databases and other role names must be corrected manually. Existing databases are not recreated; incomplete existing setups are left untouched and must be corrected manually.

## Prototype scope

- Browse and filter reports by project, date, or search terms.
- Add projects with a name, description, and color, then edit those details later.
- Delete projects only when no reports reference them.
- Administer the supplied manpower directory by Punch ID, employee name, designation, and active status.
- Open each employee's dated report log from the manpower directory to review report details and attachments.
- Add a report with a project, date, signed-in user, title, description, and multiple file attachments, with a confirmation before upload.
- Preview attached images, PDFs, DOCX/CSV text, and XLSX/CSV tables in the browser; older DOC/XLS files can be downloaded.
- Download a report package as a ZIP containing a PDF summary and all evidence attachments in an `evidence/` folder; individual attachments can also be downloaded separately.
- Store and stream uploaded files from server-local storage.
- View project cards and report counts.

## Application architecture

```text
Express API
  ├─ Authentication identity and route access checks
  ├─ Zod input validation
  ├─ Domain routes and report workflow transitions
  └─ Drizzle ORM queries and transactions
       ├─ Local PostgreSQL application data
       ├─ PC-local filesystem storage for large technical uploads
       └─ Optional email notifications when SMTP is configured
```

The API is split into route, identity/authorization, validation, domain, storage, and notification modules under `server/`. All projects, manpower changes, and report metadata are persisted in PostgreSQL. Uploaded files are streamed to `UPLOAD_DIR` (default `storage/reports`, excluded from Git); each file is limited to 512 MiB by default and can be changed with `MAX_UPLOAD_BYTES`. Reports have no file-count or combined-size cap. Reports become available to administrators immediately after upload. Admins can archive active reports; archived reports cannot be downloaded or restored through the app.

Email is disabled unless SMTP settings and `REPORT_NOTIFICATION_EMAILS` are provided. If an email fails after an upload commits, the report remains saved and the API returns a notification warning.
Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and comma-separated `REPORT_NOTIFICATION_EMAILS` in `.env` to enable upload notifications.

The employee/admin login screens use a local Express API backed by PostgreSQL and Drizzle ORM. Vite proxies `/api/*` to that API on `127.0.0.1:5001`; set `CSCFEED_API_URL` if it runs elsewhere. The API issues opaque, database-backed, HttpOnly session cookies and fails closed if the database or migrations are unavailable.

Copy `.env.example` to `.env` and set `DATABASE_URL` to the least-privilege runtime connection. Set `MIGRATION_DATABASE_URL` to a schema-owner connection for migration commands. In development, the API creates the initial `admin` account with password `admin123` if it does not already exist. Set `BOOTSTRAP_ADMIN_PASSWORD` to override that initial password. This development default is weak and must never be used in production. Production requires `BOOTSTRAP_ADMIN_PASSWORD` with at least 12 characters and applies that configured password to the administrator at startup. The administrator uses reserved Punch ID `0000`.

Employee sign-in currently accepts Punch ID alone, as requested. A Punch ID is not proof of identity, so this login method is not suitable for sensitive production reports without an additional trusted verification step. Employees can submit reports and browse/download only their own active reports in a date-ordered log; administrators can browse all active reports. Project management and manpower changes require an administrator. Projects with reports cannot be deleted, and archiving requires an administrator.

## PostgreSQL data layer

Apply the schema and idempotent 54-person roster seed with `psql`:

```powershell
$env:MIGRATION_DATABASE_URL = "postgres://..."
psql "$env:MIGRATION_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f .\database\migrations\001_core.sql
```

Apply the Drizzle-managed authentication tables after the core schema:

```powershell
npm run db:migrate
npm run db:studio
npm run dev
```

`npm run db:studio` opens Drizzle Studio on `127.0.0.1:4983` and uses `MIGRATION_DATABASE_URL` or `DATABASE_URL` from `.env`. The Drizzle auth schema is in `src/db/auth-schema.js`; the full ORM table definitions are in `src/db/schema.js`. Configuration is in `drizzle.config.js`, and generated migrations are stored in `database/drizzle`. Run migrations with the schema-owner URL. After changing a Drizzle-managed table, generate and review a migration with `npm run db:generate`, then apply it with `npm run db:migrate`.

Run the migration as a dedicated non-superuser database owner. The management functions are `SECURITY DEFINER`; do not make a superuser their owner.

The migration creates account, project, report, and report-attachment tables; Punch IDs are stored as text so leading zeroes are preserved. It also defines account upsert/activation/role/external-identity functions, project create/update/list functions, report create/list/archive/file-metadata functions, and timestamp triggers. Client-facing functions run with the migration owner’s privileges and a fixed search path; direct table and function access is revoked from `PUBLIC`.

After applying the migration, grant only the backend role access to the schema and functions. For example, run as a database administrator and replace the role name if needed:

```sql
CREATE ROLE cscfeed_app LOGIN;
GRANT USAGE ON SCHEMA cscfeed TO cscfeed_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cscfeed TO cscfeed_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON cscfeed.accounts, cscfeed.auth_credentials, cscfeed.auth_sessions,
     cscfeed.projects, cscfeed.reports, cscfeed.report_files
  TO cscfeed_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA cscfeed TO cscfeed_app;
```

The API must set `cscfeed.actor_punch_id` transaction-locally before calling the legacy account-aware PL/pgSQL functions. Never let a browser set that database context directly or expose database credentials to the client. The API bootstraps the initial admin account on first startup; the SQL roster seed itself does not promote an employee. Report rows store the first attachment for compatibility; all files are indexed in `cscfeed.report_files`, and their bytes are kept under the configured local `UPLOAD_DIR`.
