CREATE SCHEMA IF NOT EXISTS cscfeed;

CREATE TABLE IF NOT EXISTS cscfeed.accounts (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  punch_id text NOT NULL UNIQUE
    CHECK (punch_id ~ '^[0-9]{3,10}$'),
  full_name text NOT NULL
    CHECK (char_length(btrim(full_name)) BETWEEN 2 AND 160),
  designation text NOT NULL DEFAULT '',
  account_role text NOT NULL DEFAULT 'employee'
    CHECK (account_role IN ('admin', 'employee')),
  active boolean NOT NULL DEFAULT true,
  external_subject text UNIQUE,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS cscfeed.projects (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  name text NOT NULL
    CHECK (char_length(btrim(name)) BETWEEN 2 AND 120),
  description text NOT NULL DEFAULT '',
  color text NOT NULL DEFAULT 'blue'
    CHECK (color IN ('blue', 'orange', 'green', 'purple')),
  active boolean NOT NULL DEFAULT true,
  created_by bigint REFERENCES cscfeed.accounts(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS projects_name_ci_unique
  ON cscfeed.projects (lower(name));

CREATE TABLE IF NOT EXISTS cscfeed.reports (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id bigint NOT NULL REFERENCES cscfeed.projects(id) ON DELETE RESTRICT,
  uploaded_by bigint NOT NULL REFERENCES cscfeed.accounts(id) ON DELETE RESTRICT,
  report_date date NOT NULL DEFAULT CURRENT_DATE,
  title text NOT NULL
    CHECK (char_length(btrim(title)) BETWEEN 1 AND 160),
  description text NOT NULL DEFAULT '',
  file_name text NOT NULL
    CHECK (char_length(btrim(file_name)) BETWEEN 1 AND 255),
  storage_key text NOT NULL UNIQUE,
  content_type text NOT NULL,
  file_size_bytes bigint NOT NULL CHECK (file_size_bytes >= 0),
  created_at timestamptz NOT NULL DEFAULT now(),
  archived_at timestamptz,
  archived_by bigint REFERENCES cscfeed.accounts(id) ON DELETE RESTRICT
);

CREATE INDEX IF NOT EXISTS reports_project_date_idx
  ON cscfeed.reports (project_id, report_date DESC)
  WHERE archived_at IS NULL;

CREATE INDEX IF NOT EXISTS reports_uploader_date_idx
  ON cscfeed.reports (uploaded_by, report_date DESC)
  WHERE archived_at IS NULL;

CREATE OR REPLACE FUNCTION cscfeed.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_touch_updated_at ON cscfeed.accounts;
CREATE TRIGGER accounts_touch_updated_at
  BEFORE UPDATE ON cscfeed.accounts
  FOR EACH ROW EXECUTE FUNCTION cscfeed.touch_updated_at();

DROP TRIGGER IF EXISTS projects_touch_updated_at ON cscfeed.projects;
CREATE TRIGGER projects_touch_updated_at
  BEFORE UPDATE ON cscfeed.projects
  FOR EACH ROW EXECUTE FUNCTION cscfeed.touch_updated_at();

CREATE OR REPLACE FUNCTION cscfeed.current_account_id()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_punch_id text;
  v_account_id bigint;
BEGIN
  v_punch_id := NULLIF(current_setting('cscfeed.actor_punch_id', true), '');

  IF v_punch_id IS NULL THEN
    RAISE EXCEPTION 'Authenticated account context is required'
      USING ERRCODE = '42501';
  END IF;

  SELECT account.id
    INTO v_account_id
    FROM cscfeed.accounts AS account
   WHERE account.punch_id = v_punch_id
     AND account.active;

  IF v_account_id IS NULL THEN
    RAISE EXCEPTION 'Punch ID is not associated with an active account'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.require_admin()
RETURNS bigint
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account_id bigint;
BEGIN
  v_account_id := cscfeed.current_account_id();

  IF NOT EXISTS (
    SELECT 1
      FROM cscfeed.accounts AS account
     WHERE account.id = v_account_id
       AND account.account_role = 'admin'
       AND account.active
  ) THEN
    RAISE EXCEPTION 'Administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.list_accounts(p_query text DEFAULT NULL)
RETURNS TABLE (
  punch_id text,
  full_name text,
  designation text,
  account_role text,
  active boolean,
  external_subject text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
BEGIN
  PERFORM cscfeed.require_admin();

  RETURN QUERY
  SELECT account.punch_id,
         account.full_name,
         account.designation,
         account.account_role,
         account.active,
         account.external_subject
    FROM cscfeed.accounts AS account
   WHERE NULLIF(btrim(p_query), '') IS NULL
      OR concat_ws(' ', account.punch_id, account.full_name, account.designation)
         ILIKE '%' || btrim(p_query) || '%'
   ORDER BY account.full_name, account.punch_id;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.manage_account(
  p_punch_id text,
  p_full_name text,
  p_designation text
)
RETURNS cscfeed.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account cscfeed.accounts%ROWTYPE;
  v_punch_id text := btrim(COALESCE(p_punch_id, ''));
  v_full_name text := btrim(COALESCE(p_full_name, ''));
  v_designation text := btrim(COALESCE(p_designation, ''));
BEGIN
  PERFORM cscfeed.require_admin();

  IF v_punch_id !~ '^[0-9]{3,10}$' THEN
    RAISE EXCEPTION 'Punch ID must contain 3 to 10 digits'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_full_name) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Employee name must contain 2 to 160 characters'
      USING ERRCODE = '22023';
  END IF;

  INSERT INTO cscfeed.accounts (punch_id, full_name, designation)
  VALUES (v_punch_id, v_full_name, v_designation)
  ON CONFLICT (punch_id) DO UPDATE
    SET full_name = EXCLUDED.full_name,
        designation = EXCLUDED.designation
  RETURNING * INTO v_account;

  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.set_account_active(
  p_punch_id text,
  p_active boolean
)
RETURNS cscfeed.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account cscfeed.accounts%ROWTYPE;
BEGIN
  PERFORM cscfeed.require_admin();

  IF p_active IS NULL THEN
    RAISE EXCEPTION 'Account active status is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_account
    FROM cscfeed.accounts
   WHERE punch_id = btrim(COALESCE(p_punch_id, ''))
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF NOT p_active
     AND v_account.account_role = 'admin'
     AND (SELECT count(*) FROM cscfeed.accounts WHERE account_role = 'admin' AND active) <= 1 THEN
    RAISE EXCEPTION 'The last active administrator cannot be disabled'
      USING ERRCODE = '23514';
  END IF;

  UPDATE cscfeed.accounts
     SET active = p_active
   WHERE id = v_account.id
  RETURNING * INTO v_account;

  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.set_account_role(
  p_punch_id text,
  p_account_role text
)
RETURNS cscfeed.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account cscfeed.accounts%ROWTYPE;
BEGIN
  PERFORM cscfeed.require_admin();

  IF p_account_role IS NULL OR p_account_role NOT IN ('admin', 'employee') THEN
    RAISE EXCEPTION 'Account role must be admin or employee'
      USING ERRCODE = '22023';
  END IF;

  SELECT *
    INTO v_account
    FROM cscfeed.accounts
   WHERE punch_id = btrim(COALESCE(p_punch_id, ''))
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_account.active
     AND v_account.account_role = 'admin'
     AND p_account_role <> 'admin'
     AND (SELECT count(*) FROM cscfeed.accounts WHERE account_role = 'admin' AND active) <= 1 THEN
    RAISE EXCEPTION 'The last active administrator cannot be demoted'
      USING ERRCODE = '23514';
  END IF;

  UPDATE cscfeed.accounts
     SET account_role = p_account_role
   WHERE id = v_account.id
  RETURNING * INTO v_account;

  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.link_external_identity(
  p_punch_id text,
  p_external_subject text
)
RETURNS cscfeed.accounts
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account cscfeed.accounts%ROWTYPE;
BEGIN
  PERFORM cscfeed.require_admin();

  UPDATE cscfeed.accounts
     SET external_subject = NULLIF(btrim(COALESCE(p_external_subject, '')), '')
   WHERE punch_id = btrim(COALESCE(p_punch_id, ''))
  RETURNING * INTO v_account;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_account;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.create_project(
  p_name text,
  p_description text DEFAULT '',
  p_color text DEFAULT 'blue'
)
RETURNS cscfeed.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account_id bigint;
  v_project cscfeed.projects%ROWTYPE;
  v_name text := btrim(COALESCE(p_name, ''));
  v_color text := lower(btrim(COALESCE(p_color, 'blue')));
BEGIN
  v_account_id := cscfeed.require_admin();

  INSERT INTO cscfeed.projects (name, description, color, created_by)
  VALUES (
    v_name,
    btrim(COALESCE(p_description, '')),
    v_color,
    v_account_id
  )
  RETURNING * INTO v_project;

  RETURN v_project;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.update_project(
  p_project_id bigint,
  p_name text,
  p_description text,
  p_color text,
  p_active boolean DEFAULT true
)
RETURNS cscfeed.projects
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_project cscfeed.projects%ROWTYPE;
BEGIN
  PERFORM cscfeed.require_admin();

  UPDATE cscfeed.projects
     SET name = btrim(COALESCE(p_name, '')),
         description = btrim(COALESCE(p_description, '')),
         color = lower(btrim(COALESCE(p_color, ''))),
         active = p_active
   WHERE id = p_project_id
  RETURNING * INTO v_project;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Project not found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_project;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.list_projects()
RETURNS TABLE (
  project_id bigint,
  name text,
  description text,
  color text,
  created_at timestamptz,
  updated_at timestamptz
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
BEGIN
  PERFORM cscfeed.current_account_id();

  RETURN QUERY
  SELECT project.id,
         project.name,
         project.description,
         project.color,
         project.created_at,
         project.updated_at
    FROM cscfeed.projects AS project
   WHERE project.active
   ORDER BY project.name;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.create_report(
  p_project_id bigint,
  p_report_date date,
  p_title text,
  p_description text,
  p_file_name text,
  p_storage_key text,
  p_content_type text,
  p_file_size_bytes bigint
)
RETURNS cscfeed.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account_id bigint;
  v_report cscfeed.reports%ROWTYPE;
BEGIN
  v_account_id := cscfeed.current_account_id();

  IF NOT EXISTS (
    SELECT 1 FROM cscfeed.projects
     WHERE id = p_project_id
       AND active
  ) THEN
    RAISE EXCEPTION 'Active project not found'
      USING ERRCODE = 'P0002';
  END IF;

  INSERT INTO cscfeed.reports (
    project_id,
    uploaded_by,
    report_date,
    title,
    description,
    file_name,
    storage_key,
    content_type,
    file_size_bytes
  )
  VALUES (
    p_project_id,
    v_account_id,
    COALESCE(p_report_date, CURRENT_DATE),
    btrim(COALESCE(p_title, '')),
    btrim(COALESCE(p_description, '')),
    btrim(COALESCE(p_file_name, '')),
    btrim(COALESCE(p_storage_key, '')),
    btrim(COALESCE(p_content_type, 'application/octet-stream')),
    p_file_size_bytes
  )
  RETURNING * INTO v_report;

  RETURN v_report;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.list_reports(
  p_project_id bigint DEFAULT NULL,
  p_from_date date DEFAULT NULL,
  p_to_date date DEFAULT NULL,
  p_query text DEFAULT NULL
)
RETURNS TABLE (
  report_id bigint,
  project_id bigint,
  project_name text,
  uploaded_by_punch_id text,
  uploaded_by_name text,
  report_date date,
  title text,
  description text,
  file_name text,
  content_type text,
  file_size_bytes bigint
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
  SELECT report.id,
         project.id,
         project.name,
         account.punch_id,
         account.full_name,
         report.report_date,
         report.title,
         report.description,
         report.file_name,
         report.content_type,
         report.file_size_bytes
    FROM cscfeed.reports AS report
    JOIN cscfeed.projects AS project ON project.id = report.project_id
    JOIN cscfeed.accounts AS account ON account.id = report.uploaded_by
   WHERE report.archived_at IS NULL
     AND cscfeed.current_account_id() IS NOT NULL
     AND (p_project_id IS NULL OR report.project_id = p_project_id)
     AND (p_from_date IS NULL OR report.report_date >= p_from_date)
     AND (p_to_date IS NULL OR report.report_date <= p_to_date)
     AND (
       NULLIF(btrim(p_query), '') IS NULL
       OR concat_ws(' ', report.title, report.description, account.full_name, account.punch_id, report.file_name)
          ILIKE '%' || btrim(p_query) || '%'
     )
   ORDER BY report.report_date DESC, report.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION cscfeed.get_report_file_metadata(p_report_id bigint)
RETURNS TABLE (
  file_name text,
  content_type text,
  file_size_bytes bigint,
  storage_key text
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
BEGIN
  PERFORM cscfeed.current_account_id();

  RETURN QUERY
  SELECT report.file_name,
         report.content_type,
         report.file_size_bytes,
         report.storage_key
    FROM cscfeed.reports AS report
   WHERE report.id = p_report_id
     AND report.archived_at IS NULL;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found'
      USING ERRCODE = 'P0002';
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.archive_report(p_report_id bigint)
RETURNS cscfeed.reports
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account_id bigint;
  v_report cscfeed.reports%ROWTYPE;
BEGIN
  v_account_id := cscfeed.require_admin();

  UPDATE cscfeed.reports
     SET archived_at = COALESCE(archived_at, now()),
         archived_by = COALESCE(archived_by, v_account_id)
   WHERE id = p_report_id
  RETURNING * INTO v_report;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Report not found'
      USING ERRCODE = 'P0002';
  END IF;

  RETURN v_report;
END;
$$;

REVOKE ALL ON SCHEMA cscfeed FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA cscfeed FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA cscfeed FROM PUBLIC;
REVOKE EXECUTE ON ALL FUNCTIONS IN SCHEMA cscfeed FROM PUBLIC;
