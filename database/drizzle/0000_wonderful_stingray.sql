CREATE TABLE "cscfeed"."auth_credentials" (
	"account_id" bigint PRIMARY KEY NOT NULL,
	"username" text NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "auth_credentials_username_unique" UNIQUE("username")
);
--> statement-breakpoint
CREATE TABLE "cscfeed"."auth_sessions" (
	"token_hash" text PRIMARY KEY NOT NULL,
	"account_id" bigint NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "cscfeed"."auth_credentials"
  ADD CONSTRAINT "auth_credentials_account_id_accounts_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "cscfeed"."accounts"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
ALTER TABLE "cscfeed"."auth_sessions"
  ADD CONSTRAINT "auth_sessions_account_id_accounts_id_fk"
  FOREIGN KEY ("account_id") REFERENCES "cscfeed"."accounts"("id")
  ON DELETE cascade ON UPDATE no action;
--> statement-breakpoint
CREATE INDEX "auth_sessions_account_id_idx" ON "cscfeed"."auth_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "auth_sessions_expires_at_idx" ON "cscfeed"."auth_sessions" USING btree ("expires_at");