ALTER TABLE cscfeed.auth_credentials
  ADD COLUMN IF NOT EXISTS password_ciphertext text;
