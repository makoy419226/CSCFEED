# CSC Feed — Project Reports

A responsive frontend skeleton for sharing reports across multiple projects. The interface follows the reference app's compact sidebar, blue-accented controls, cards, and accessible form patterns.

## Run locally

```sh
npm install
npm run dev
```

## Prototype scope

- Browse and filter reports by project, date, or search terms.
- Add projects with a name, description, and color, then edit those details later.
- Administer the supplied manpower directory by Punch ID, employee name, designation, and active status.
- Add a report with a project, date, signed-in user, title, description, and file.
- Download files added during the current browser session.
- View project cards and report counts.

The employee/admin login screens follow the reference app's sign-in pattern. The app stays locked until the auth server confirms the session; it does not authenticate against the browser-side roster. Employee sign-in submits only the Punch ID, as requested. A Punch ID is an identifier, not proof of identity, so this mode is not safe for sensitive production reports without a trusted additional verification step.

In development, Vite proxies `/api/auth/*` to the existing Concord ERP auth server at `http://127.0.0.1:5000` by default. Start that server as well as CSC Feed. If it uses another origin, set `CONCORDERP_AUTH_URL` before starting Vite. `authIdentity.ts` resolves an already-issued ERP session; the login route itself is in the ERP server. CSC Feed does not connect directly to the ERP database.

The login flow uses `GET /api/auth/session`, `POST /api/auth/login`, and `POST /api/auth/logout`. Admin login submits a username and password; the server checks the account's admin role. If the auth server is stopped or unreachable, sign-in fails closed and reports remain inaccessible. Production hosting must also proxy these routes to the trusted auth server. Project, manpower, report, and file changes remain in browser memory and reset on refresh; the PostgreSQL migration below is not yet connected to those UI flows.

The ERP session endpoint returns `401` when signed out and a user object containing `name`, `role`, and `username` for a valid session; CSC Feed uses `username` as the Punch ID when no explicit `punchId` is returned. The ERP login endpoint sets an `HttpOnly` session cookie, and logout clears it. Protect report and file APIs on the server as well—hiding pages in the browser is not authorization. The current admin/manpower controls are frontend-only and reset on refresh.

## PostgreSQL data layer

Apply the schema and idempotent 54-person roster seed with `psql`:

```powershell
psql "$env:DATABASE_URL" --single-transaction -v ON_ERROR_STOP=1 -f .\database\migrations\001_core.sql
```

Run the migration as a dedicated non-superuser database owner. The management functions are `SECURITY DEFINER`; do not make a superuser their owner.

The migration creates account, project, and report tables; Punch IDs are stored as text so leading zeroes are preserved. It also defines account upsert/activation/role/external-identity functions, project create/update/list functions, report create/list/archive/file-metadata functions, and timestamp triggers. Client-facing functions run with the migration owner’s privileges and a fixed search path; direct table and function access is revoked from `PUBLIC`.

After applying the migration, grant only the backend role access to the schema and functions. For example, run as a database administrator and replace the role name if needed:

```sql
CREATE ROLE cscfeed_app LOGIN;
GRANT USAGE ON SCHEMA cscfeed TO cscfeed_app;
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA cscfeed TO cscfeed_app;
```

Before calling account-aware functions, the server must validate the user's Punch ID with the trusted identity provider and set `cscfeed.actor_punch_id` transaction-locally. Never let a browser set that database context directly or expose database credentials to the client. The seed does not promote anyone to administrator; a trusted database operator must assign the initial admin after verifying the person's identity. Report rows store file metadata and a storage key, not file bytes—the server still needs to connect the uploader to private object storage.
