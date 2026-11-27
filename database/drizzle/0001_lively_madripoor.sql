CREATE TABLE "cscfeed"."report_files" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY NOT NULL,
	"report_id" bigint NOT NULL,
	"file_name" text NOT NULL,
	"storage_key" text NOT NULL,
	"content_type" text NOT NULL,
	"file_size_bytes" bigint NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "report_files_file_name_length_check"
		CHECK (char_length(btrim("file_name")) BETWEEN 1 AND 255),
	CONSTRAINT "report_files_file_size_check"
		CHECK ("file_size_bytes" >= 0)
);
--> statement-breakpoint
ALTER TABLE "cscfeed"."report_files"
	ADD CONSTRAINT "report_files_report_id_reports_id_fk"
	FOREIGN KEY ("report_id") REFERENCES "cscfeed"."reports"("id")
	ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE UNIQUE INDEX "report_files_storage_key_unique"
	ON "cscfeed"."report_files" USING btree ("storage_key");
--> statement-breakpoint
CREATE INDEX "report_files_report_id_idx"
	ON "cscfeed"."report_files" USING btree ("report_id");
--> statement-breakpoint
INSERT INTO "cscfeed"."report_files" (
	"report_id", "file_name", "storage_key", "content_type", "file_size_bytes", "created_at"
)
SELECT
	"id", "file_name", "storage_key", "content_type", "file_size_bytes", "created_at"
FROM "cscfeed"."reports"
ON CONFLICT ("storage_key") DO NOTHING;
