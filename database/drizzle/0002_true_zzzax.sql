ALTER TABLE "cscfeed"."accounts" ADD COLUMN "project_id" bigint;
--> statement-breakpoint
ALTER TABLE "cscfeed"."accounts"
	ADD CONSTRAINT "accounts_project_id_projects_id_fk"
	FOREIGN KEY ("project_id") REFERENCES "cscfeed"."projects"("id")
	ON DELETE set null ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "accounts_project_id_idx" ON "cscfeed"."accounts" USING btree ("project_id");
