ALTER TABLE cscfeed.reports
  ADD COLUMN IF NOT EXISTS uploader_name text,
  ADD COLUMN IF NOT EXISTS uploader_punch_id text;

UPDATE cscfeed.reports AS report
   SET uploader_name = account.full_name,
       uploader_punch_id = account.punch_id
  FROM cscfeed.accounts AS account
 WHERE account.id = report.uploaded_by
   AND (report.uploader_name IS NULL OR report.uploader_punch_id IS NULL);

ALTER TABLE cscfeed.reports
  ALTER COLUMN uploader_name SET NOT NULL,
  ALTER COLUMN uploader_punch_id SET NOT NULL,
  ALTER COLUMN uploaded_by DROP NOT NULL;

ALTER TABLE cscfeed.projects
  DROP CONSTRAINT IF EXISTS projects_created_by_fkey,
  DROP CONSTRAINT IF EXISTS projects_created_by_accounts_id_fk;
ALTER TABLE cscfeed.projects
  ADD CONSTRAINT projects_created_by_fkey
  FOREIGN KEY (created_by) REFERENCES cscfeed.accounts(id) ON DELETE SET NULL;

ALTER TABLE cscfeed.reports
  DROP CONSTRAINT IF EXISTS reports_uploaded_by_fkey,
  DROP CONSTRAINT IF EXISTS reports_uploaded_by_accounts_id_fk,
  DROP CONSTRAINT IF EXISTS reports_archived_by_fkey,
  DROP CONSTRAINT IF EXISTS reports_archived_by_accounts_id_fk;
ALTER TABLE cscfeed.reports
  ADD CONSTRAINT reports_uploaded_by_fkey
    FOREIGN KEY (uploaded_by) REFERENCES cscfeed.accounts(id) ON DELETE SET NULL,
  ADD CONSTRAINT reports_archived_by_fkey
    FOREIGN KEY (archived_by) REFERENCES cscfeed.accounts(id) ON DELETE SET NULL;

CREATE OR REPLACE FUNCTION cscfeed.snapshot_report_uploader()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, cscfeed
AS $$
BEGIN
  IF NEW.uploaded_by IS NOT NULL
     AND (NEW.uploader_name IS NULL OR NEW.uploader_punch_id IS NULL) THEN
    SELECT account.full_name, account.punch_id
      INTO NEW.uploader_name, NEW.uploader_punch_id
      FROM cscfeed.accounts AS account
     WHERE account.id = NEW.uploaded_by;

    IF NEW.uploader_name IS NULL OR NEW.uploader_punch_id IS NULL THEN
      RAISE EXCEPTION 'Report uploader must be an existing account';
    END IF;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS reports_snapshot_uploader ON cscfeed.reports;
CREATE TRIGGER reports_snapshot_uploader
  BEFORE INSERT OR UPDATE ON cscfeed.reports
  FOR EACH ROW EXECUTE FUNCTION cscfeed.snapshot_report_uploader();

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
         report.uploader_punch_id,
         report.uploader_name,
         report.report_date,
         report.title,
         report.description,
         report.file_name,
         report.content_type,
         report.file_size_bytes
    FROM cscfeed.reports AS report
    JOIN cscfeed.projects AS project ON project.id = report.project_id
   WHERE report.archived_at IS NULL
     AND cscfeed.current_account_id() IS NOT NULL
     AND (p_project_id IS NULL OR report.project_id = p_project_id)
     AND (p_from_date IS NULL OR report.report_date >= p_from_date)
     AND (p_to_date IS NULL OR report.report_date <= p_to_date)
     AND (
       NULLIF(btrim(p_query), '') IS NULL
       OR concat_ws(
         ' ',
         report.title,
         report.description,
         report.uploader_name,
         report.uploader_punch_id,
         report.file_name
       ) ILIKE '%' || btrim(p_query) || '%'
     )
   ORDER BY report.report_date DESC, report.created_at DESC;
$$;
