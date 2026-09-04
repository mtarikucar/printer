import { defineConfig } from "drizzle-kit";

/**
 * `scripts/test-workshop-cancel.ts`in scratch şemasını kurmak için kullandığı
 * ÇEVRİMDIŞI config. Yalnızca schema.ts'ten DDL üretir (`generate`); hiçbir
 * veritabanına bağlanmaz, dolayısıyla dev DB'ye migration uygulayamaz.
 */
const out = process.env.SCRATCH_OUT;
if (!out) {
  throw new Error(
    "SCRATCH_OUT tanımlı değil. Bu config elle çalıştırılmaz; " +
      "`npm run test:workshop-cancel` (scripts/test-workshop-cancel.ts) onu " +
      "geçici bir dizine ayarlayarak çağırır."
  );
}

export default defineConfig({
  schema: "./src/lib/db/schema.ts",
  out,
  dialect: "postgresql",
});
