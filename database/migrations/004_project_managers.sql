ALTER TABLE cscfeed.projects
  ADD COLUMN IF NOT EXISTS manager_id bigint;

ALTER TABLE cscfeed.projects
  DROP CONSTRAINT IF EXISTS projects_manager_id_fkey,
  DROP CONSTRAINT IF EXISTS projects_manager_id_accounts_id_fk;
ALTER TABLE cscfeed.projects
  ADD CONSTRAINT projects_manager_id_fkey
  FOREIGN KEY (manager_id) REFERENCES cscfeed.accounts(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX IF NOT EXISTS projects_manager_id_unique
  ON cscfeed.projects (manager_id)
  WHERE manager_id IS NOT NULL;

CREATE OR REPLACE FUNCTION cscfeed.validate_project_manager()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account_role text;
  v_active boolean;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT account.account_role, account.active
    INTO v_account_role, v_active
    FROM cscfeed.accounts AS account
   WHERE account.id = NEW.manager_id
   FOR KEY SHARE;

  IF NOT FOUND OR v_account_role <> 'employee' OR NOT v_active THEN
    RAISE EXCEPTION 'Project manager must be an active employee'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS projects_validate_manager ON cscfeed.projects;
CREATE TRIGGER projects_validate_manager
  BEFORE INSERT OR UPDATE ON cscfeed.projects
  FOR EACH ROW EXECUTE FUNCTION cscfeed.validate_project_manager();

CREATE OR REPLACE FUNCTION cscfeed.clear_ineligible_project_manager()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, cscfeed
AS $$
BEGIN
  IF NOT NEW.active OR NEW.account_role <> 'employee' THEN
    UPDATE cscfeed.projects
       SET manager_id = NULL
     WHERE manager_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_clear_ineligible_project_manager ON cscfeed.accounts;
CREATE TRIGGER accounts_clear_ineligible_project_manager
  AFTER UPDATE OF active, account_role ON cscfeed.accounts
  FOR EACH ROW
  WHEN (OLD.active IS DISTINCT FROM NEW.active OR OLD.account_role IS DISTINCT FROM NEW.account_role)
  EXECUTE FUNCTION cscfeed.clear_ineligible_project_manager();
