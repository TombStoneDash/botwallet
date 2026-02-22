import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.BOTWALLET_DATABASE_URL!,
  },
  schemaFilter: ["botwallet"],
});
