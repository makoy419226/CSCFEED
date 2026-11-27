ALTER TABLE cscfeed.accounts
  DROP CONSTRAINT IF EXISTS accounts_account_role_check;

ALTER TABLE cscfeed.accounts
  ADD CONSTRAINT accounts_account_role_check
  CHECK (account_role IN ('employee', 'admin', 'project_manager', 'super_admin'));

DROP INDEX IF EXISTS cscfeed.projects_manager_id_unique;

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

  IF NOT FOUND OR v_account_role <> 'project_manager' OR NOT v_active THEN
    RAISE EXCEPTION 'Project manager must be an active appointed Project Manager'
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.clear_ineligible_project_manager()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, cscfeed
AS $$
BEGIN
  IF NOT NEW.active OR NEW.account_role <> 'project_manager' THEN
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

UPDATE cscfeed.accounts AS account
   SET account_role = 'project_manager'
 WHERE account.account_role = 'employee'
   AND EXISTS (
     SELECT 1
       FROM cscfeed.projects AS project
      WHERE project.manager_id = account.id
   );
