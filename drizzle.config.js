import "dotenv/config";
import { defineConfig } from "drizzle-kit";

const migrationUrl = process.env.MIGRATION_DATABASE_URL || process.env.DATABASE_URL;
if (!migrationUrl) {
  throw new Error("MIGRATION_DATABASE_URL or DATABASE_URL must be set before running Drizzle commands.");
}

export default defineConfig({
  schema: "./src/db/auth-schema.js",
  out: "./database/drizzle",
  dialect: "postgresql",
  migrations: {
    schema: "cscfeed",
    table: "__drizzle_migrations",
  },
  dbCredentials: {
    url: migrationUrl,
  },
  schemaFilter: ["cscfeed"],
  tablesFilter: ["auth_credentials", "auth_sessions"],
});
