ALTER TABLE cscfeed.accounts
  DROP CONSTRAINT IF EXISTS accounts_account_role_check;

ALTER TABLE cscfeed.accounts
  ADD CONSTRAINT accounts_account_role_check
  CHECK (account_role IN ('employee', 'admin', 'super_admin'));

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
       AND account.account_role IN ('admin', 'super_admin')
       AND account.active
  ) THEN
    RAISE EXCEPTION 'Administrator access is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_account_id;
END;
$$;

CREATE OR REPLACE FUNCTION cscfeed.require_super_user()
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
       AND account.account_role = 'super_admin'
       AND account.active
  ) THEN
    RAISE EXCEPTION 'Super User access is required'
      USING ERRCODE = '42501';
  END IF;

  RETURN v_account_id;
END;
$$;

REVOKE EXECUTE ON FUNCTION cscfeed.require_super_user() FROM PUBLIC;

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
  v_actor_id bigint;
  v_actor_role text;
  v_punch_id text := btrim(COALESCE(p_punch_id, ''));
  v_full_name text := btrim(COALESCE(p_full_name, ''));
  v_designation text := btrim(COALESCE(p_designation, ''));
BEGIN
  v_actor_id := cscfeed.require_admin();
  SELECT account_role INTO v_actor_role
    FROM cscfeed.accounts
   WHERE id = v_actor_id;

  IF v_punch_id !~ '^[0-9]{3,10}$' THEN
    RAISE EXCEPTION 'Punch ID must contain 3 to 10 digits'
      USING ERRCODE = '22023';
  END IF;

  IF char_length(v_full_name) NOT BETWEEN 2 AND 160 THEN
    RAISE EXCEPTION 'Employee name must contain 2 to 160 characters'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_account
    FROM cscfeed.accounts
   WHERE punch_id = v_punch_id
   FOR UPDATE;

  IF v_punch_id = '0000'
     OR (FOUND AND v_account.account_role = 'super_admin') THEN
    RAISE EXCEPTION 'The Super User account cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF FOUND AND v_account.account_role = 'admin' AND v_actor_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Only the Super User can change administrator accounts'
      USING ERRCODE = '42501';
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
  v_actor_id bigint;
  v_actor_role text;
BEGIN
  v_actor_id := cscfeed.require_admin();
  SELECT account_role INTO v_actor_role
    FROM cscfeed.accounts
   WHERE id = v_actor_id;

  IF p_active IS NULL THEN
    RAISE EXCEPTION 'Account active status is required'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_account
    FROM cscfeed.accounts
   WHERE punch_id = btrim(COALESCE(p_punch_id, ''))
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_account.punch_id = '0000' OR v_account.account_role = 'super_admin' THEN
    RAISE EXCEPTION 'The Super User account cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF v_account.account_role = 'admin' AND v_actor_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Only the Super User can change administrator accounts'
      USING ERRCODE = '42501';
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
  PERFORM cscfeed.require_super_user();

  IF p_account_role IS NULL OR p_account_role NOT IN ('admin', 'employee') THEN
    RAISE EXCEPTION 'Account role must be admin or employee'
      USING ERRCODE = '22023';
  END IF;

  SELECT * INTO v_account
    FROM cscfeed.accounts
   WHERE punch_id = btrim(COALESCE(p_punch_id, ''))
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_account.punch_id = '0000' OR v_account.account_role = 'super_admin' THEN
    RAISE EXCEPTION 'The Super User account cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF p_account_role = 'admin' AND NOT v_account.active THEN
    RAISE EXCEPTION 'Activate this account before granting admin access'
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
  v_actor_id bigint;
  v_actor_role text;
BEGIN
  v_actor_id := cscfeed.require_admin();
  SELECT account_role INTO v_actor_role
    FROM cscfeed.accounts
   WHERE id = v_actor_id;

  SELECT * INTO v_account
    FROM cscfeed.accounts
   WHERE punch_id = btrim(COALESCE(p_punch_id, ''))
   FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Account not found'
      USING ERRCODE = 'P0002';
  END IF;

  IF v_account.punch_id = '0000' OR v_account.account_role = 'super_admin' THEN
    RAISE EXCEPTION 'The Super User account cannot be changed'
      USING ERRCODE = '42501';
  END IF;

  IF v_account.account_role = 'admin' AND v_actor_role <> 'super_admin' THEN
    RAISE EXCEPTION 'Only the Super User can change administrator accounts'
      USING ERRCODE = '42501';
  END IF;

  UPDATE cscfeed.accounts
     SET external_subject = NULLIF(btrim(COALESCE(p_external_subject, '')), '')
   WHERE id = v_account.id
  RETURNING * INTO v_account;

  RETURN v_account;
END;
$$;
