import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out: process.env.SCRATCH_OUT!,
  dialect: "postgresql",
});
