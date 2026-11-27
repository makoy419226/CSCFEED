# CSC Feed — Project Reports

A responsive frontend skeleton for sharing reports across multiple projects. The interface follows the reference app's compact sidebar, blue-accented controls, cards, and accessible form patterns.

## Run locally

```sh
npm install
```

After installing PostgreSQL and Node.js, run `.\scripts\start-local.ps1` in PowerShell or `npm run dev`. Both use the same preflight/setup flow and check that the API and web ports are free. On first run, the Node setup asks for the PostgreSQL administrator credentials, creates the `cscfeed` database and dedicated owner/app roles with generated passwords, writes their connection URLs to the Git-ignored `.env`, applies both migrations, grants the app role access, and starts the app. The administrator password is entered without echo and is not saved. Existing `cscfeed` roles or databases are never overwritten; configure their valid URLs in `.env` instead.

The script starts a stopped PostgreSQL Windows service if exactly one is installed. If service permissions prevent this, start PostgreSQL from Windows Services and rerun the script. It does not terminate a process that already owns the API port. `npm run dev:stack` runs the API and web processes directly without preflight or database migrations.

To configure an existing database manually, copy `.env.example` to `.env` and set valid `DATABASE_URL` and `MIGRATION_DATABASE_URL` values before running `npm run dev:local`.

## Prototype scope

- Browse and filter reports by project, date, or search terms.
- Add projects with a name, description, and color, then edit those details later.
- Administer the supplied manpower directory by Punch ID, employee name, designation, and active status.
- Add a report with a project, date, signed-in user, title, description, and file.
- Download files from server-local storage.
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

The API is split into route, identity/authorization, validation, domain, storage, and notification modules under `server/`. All projects, manpower changes, and report metadata are persisted in PostgreSQL. Uploaded files are streamed to `UPLOAD_DIR` (default `storage/reports`, excluded from Git); the default per-file limit is 512 MiB and can be changed with `MAX_UPLOAD_BYTES`. Reports become available immediately after upload. Admins can archive active reports; archived reports cannot be downloaded or restored through the app.

Email is disabled unless SMTP settings and `REPORT_NOTIFICATION_EMAILS` are provided. If an email fails after an upload commits, the report remains saved and the API returns a notification warning.
Configure `SMTP_HOST`, `SMTP_PORT`, `SMTP_SECURE`, `SMTP_USER`, `SMTP_PASSWORD`, `SMTP_FROM`, and comma-separated `REPORT_NOTIFICATION_EMAILS` in `.env` to enable upload notifications.

The employee/admin login screens use a local Express API backed by PostgreSQL and Drizzle ORM. Vite proxies `/api/*` to that API on `127.0.0.1:5001`; set `CSCFEED_API_URL` if it runs elsewhere. The API issues opaque, database-backed, HttpOnly session cookies and fails closed if the database or migrations are unavailable.

Copy `.env.example` to `.env` and set `DATABASE_URL` to the least-privilege runtime connection. Set `MIGRATION_DATABASE_URL` to a schema-owner connection for migration commands. In development, the API creates the initial `admin` account with password `admin123` if it does not already exist. Set `BOOTSTRAP_ADMIN_PASSWORD` to override that initial password. This development default is weak and must never be used in production. Production requires `BOOTSTRAP_ADMIN_PASSWORD` with at least 12 characters and applies that configured password to the administrator at startup. The administrator uses reserved Punch ID `0000`.

Employee sign-in currently accepts Punch ID alone, as requested. A Punch ID is not proof of identity, so this login method is not suitable for sensitive production reports without an additional trusted verification step. Project and manpower changes require an administrator; report upload and download require a valid session, and archiving requires an administrator.

## PostgreSQL data layer

Apply the schema and idempotent 54-person roster seed with `psql`:

```powershell
$env:MIGRATION_DATABASE_URL = "postgres://..."
psql "$env:MIGRATION_DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f .\database\migrations\001_core.sql
```

Apply the Drizzle-managed authentication tables after the core schema:

```powershell
npm run db:migrate
npm run dev
```

The Drizzle auth schema is in `src/db/auth-schema.js`; the full ORM table definitions are in `src/db/schema.js`. Configuration is in `drizzle.config.js`, and generated migrations are stored in `database/drizzle`. Run migrations with the schema-owner URL. After changing the auth schema, generate and review a migration with `npm run db:generate`, then apply it with `npm run db:migrate`.

Run the migration as a dedicated non-superuser database owner. The management functions are `SECURITY DEFINER`; do not make a superuser their owner.

The migration creates account, project, and report tables; Punch IDs are stored as text so leading zeroes are preserved. It also defines account upsert/activation/role/external-identity functions, project create/update/list functions, report create/list/archive/file-metadata functions, and timestamp triggers. Client-facing functions run with the migration owner’s privileges and a fixed search path; direct table and function access is revoked from `PUBLIC`.

After applying the migration, grant only the backend role access to the schema and functions. For example, run as a database administrator and replace the role name if needed:

```sql
CREATE ROLE cscfeed_app LOGIN;
GRANT USAGE ON SCHEMA cscfeed TO cscfeed_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cscfeed TO cscfeed_app;
GRANT SELECT, INSERT, UPDATE, DELETE
  ON cscfeed.accounts, cscfeed.auth_credentials, cscfeed.auth_sessions,
     cscfeed.projects, cscfeed.reports
  TO cscfeed_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA cscfeed TO cscfeed_app;
```

The API must set `cscfeed.actor_punch_id` transaction-locally before calling the legacy account-aware PL/pgSQL functions. Never let a browser set that database context directly or expose database credentials to the client. The API bootstraps the initial admin account on first startup; the SQL roster seed itself does not promote an employee. Report rows store file metadata and a storage key; the corresponding file bytes are kept under the configured local `UPLOAD_DIR`.
