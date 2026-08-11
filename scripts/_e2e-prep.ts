import "dotenv/config";
import { writeFileSync } from "node:fs";
import { mkdir } from "node:fs/promises";
import { eq } from "drizzle-orm";
import { db } from "../src/lib/db";
import { manufacturers } from "../src/lib/db/schema";
import { hashPassword } from "../src/lib/services/customer-auth";

// E2E prep: (1) bcrypt hash for the admin login env, (2) a real password for a
// demo manufacturer, (3) a real STL file on disk for upload-order downloads.
async function main() {
  const adminHash = await hashPassword("verify1234");
  writeFileSync("/tmp/adminhash", adminHash);
  console.log("admin hash written to /tmp/adminhash");

  const mfgHash = await hashPassword("test1234");
  const r = await db
    .update(manufacturers)
    .set({ passwordHash: mfgHash })
    .where(eq(manufacturers.email, "atolye3d@demo.local"))
    .returning({ id: manufacturers.id, email: manufacturers.email });
  console.log("manufacturer password set:", r[0]?.email ?? "NOT FOUND");

  const uploadDir = (process.env.UPLOAD_DIR || "./uploads") + "/models-upload";
  await mkdir(uploadDir, { recursive: true });
  const stl = `solid e2e
 facet normal 0 0 1
  outer loop
   vertex 0 0 0
   vertex 10 0 0
   vertex 0 10 0
  endloop
 endfacet
endsolid e2e
`;
  writeFileSync(uploadDir + "/e2e-test.stl", stl);
  console.log("test STL written:", uploadDir + "/e2e-test.stl");
  process.exit(0);
}
main().catch((e) => {
  console.error(e);
  process.exit(1);
});
