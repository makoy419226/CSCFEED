ALTER TABLE "cscfeed"."accounts" ADD COLUMN "project_id" bigint;
--> statement-breakpoint
ALTER TABLE "cscfeed"."accounts"
	ADD CONSTRAINT "accounts_project_id_projects_id_fk"
	FOREIGN KEY ("project_id") REFERENCES "cscfeed"."projects"("id")
	ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "accounts_project_id_idx" ON "cscfeed"."accounts" USING btree ("project_id");
--> statement-breakpoint
DO $$
DECLARE
	v_project_id bigint;
	v_project_count integer;
BEGIN
	SELECT count(*), min(id)
	  INTO v_project_count, v_project_id
	  FROM "cscfeed"."projects"
	 WHERE active
	   AND name ILIKE '%DS415%';

	IF v_project_count > 1 THEN
		RAISE EXCEPTION 'More than one active project matches DS415; manpower assignments were not changed.';
	END IF;

	IF v_project_count = 1 THEN
		UPDATE "cscfeed"."accounts"
		   SET project_id = v_project_id
		 WHERE punch_id NOT IN ('0000', '5755')
		   AND account_role IN ('employee', 'admin');
	END IF;
END
$$;
