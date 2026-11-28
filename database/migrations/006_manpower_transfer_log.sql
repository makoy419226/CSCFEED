CREATE TABLE IF NOT EXISTS cscfeed.manpower_transfers (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  employee_punch_id text NOT NULL,
  employee_name text NOT NULL,
  from_project_name text,
  to_project_name text,
  transferred_by bigint REFERENCES cscfeed.accounts(id) ON DELETE SET NULL,
  transferred_by_name text NOT NULL,
  transferred_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS manpower_transfers_transferred_at_idx
  ON cscfeed.manpower_transfers (transferred_at DESC);
