ALTER TABLE cscfeed.accounts
  ADD COLUMN IF NOT EXISTS admin_base_role text;

ALTER TABLE cscfeed.accounts
  DROP CONSTRAINT IF EXISTS accounts_admin_base_role_check;
ALTER TABLE cscfeed.accounts
  ADD CONSTRAINT accounts_admin_base_role_check
  CHECK (
    admin_base_role IS NULL
    OR (account_role = 'admin' AND admin_base_role IN ('employee', 'project_manager'))
  );

CREATE OR REPLACE FUNCTION cscfeed.validate_project_manager()
RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, cscfeed
AS $$
DECLARE
  v_account_role text;
  v_admin_base_role text;
  v_active boolean;
BEGIN
  IF NEW.manager_id IS NULL THEN
    RETURN NEW;
  END IF;

  SELECT account.account_role, account.admin_base_role, account.active
    INTO v_account_role, v_admin_base_role, v_active
    FROM cscfeed.accounts AS account
   WHERE account.id = NEW.manager_id
   FOR KEY SHARE;

  IF NOT FOUND
     OR NOT v_active
     OR NOT (v_account_role = 'project_manager'
       OR (v_account_role = 'admin' AND v_admin_base_role = 'project_manager')) THEN
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
  IF NOT NEW.active
     OR NOT (NEW.account_role = 'project_manager'
       OR (NEW.account_role = 'admin' AND NEW.admin_base_role = 'project_manager')) THEN
    UPDATE cscfeed.projects
       SET manager_id = NULL
     WHERE manager_id = NEW.id;
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS accounts_clear_ineligible_project_manager ON cscfeed.accounts;
CREATE TRIGGER accounts_clear_ineligible_project_manager
  AFTER UPDATE OF active, account_role, admin_base_role ON cscfeed.accounts
  FOR EACH ROW
  WHEN (
    OLD.active IS DISTINCT FROM NEW.active
    OR OLD.account_role IS DISTINCT FROM NEW.account_role
    OR OLD.admin_base_role IS DISTINCT FROM NEW.admin_base_role
  )
  EXECUTE FUNCTION cscfeed.clear_ineligible_project_manager();
