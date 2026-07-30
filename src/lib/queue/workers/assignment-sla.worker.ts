import { Worker, Job } from "bullmq";
import { and, eq, lt, sql, isNotNull } from "drizzle-orm";
import { getRedisConnection } from "../connection";
import { db } from "../../db";
import { orders, manufacturers } from "../../db/schema";
import { getEmailQueue } from "../queues";

/**
 * The assignment email tells a manufacturer to accept or decline within 24
 * hours, and nothing in the system ever checked. An unanswered order simply sat
 * there until somebody noticed by hand.
 *
 * This flags them; it deliberately does NOT revoke automatically:
 *  - store orders are assigned at checkout and never receive that 24h email, so
 *    an automatic revoke would punish a promise never made,
 *  - and a strike-driven auto-suspension could take a partner offline while
 *    they are simply on holiday.
 * The admin then decides, using the revoke control on the order page.
 */
const SLA_HOURS = 24;
const FLAG = "[SLA]";

async function processJob(job: Job) {
  const stale = await db
    .select({
      id: orders.id,
      orderNumber: orders.orderNumber,
      assignedAt: orders.assignedToManufacturerAt,
      adminNotes: orders.adminNotes,
      companyName: manufacturers.companyName,
      manufacturerEmail: manufacturers.email,
    })
    .from(orders)
    .leftJoin(manufacturers, eq(manufacturers.id, orders.manufacturerId))
    .where(
      and(
        eq(orders.manufacturerStatus, "assigned"),
        isNotNull(orders.assignedToManufacturerAt),
        lt(
          orders.assignedToManufacturerAt,
          new Date(Date.now() - SLA_HOURS * 3600 * 1000)
        )
      )
    );

  // Skip the ones already flagged so a partner is not emailed about hourly.
  const fresh = stale.filter((o) => !(o.adminNotes ?? "").includes(FLAG));
  if (fresh.length === 0) {
    job.log(`No newly-stale assignments (${stale.length} already flagged)`);
    return;
  }

  for (const o of fresh) {
    const hours = o.assignedAt
      ? Math.floor((Date.now() - o.assignedAt.getTime()) / 3600000)
      : SLA_HOURS;
    const note = `${FLAG} ${o.companyName ?? "Üretici"} ${hours} saattir yanıt vermedi (24 saatlik süre aşıldı).`;
    await db
      .update(orders)
      .set({
        adminNotes: sql`CASE WHEN ${orders.adminNotes} IS NULL OR ${orders.adminNotes} = ''
                        THEN ${note} ELSE ${orders.adminNotes} || E'\n' || ${note} END`,
        updatedAt: new Date(),
      })
      .where(eq(orders.id, o.id));
  }

  const adminEmail = process.env.ADMIN_EMAIL || "system@figurunica.com";
  await getEmailQueue()
    .add("admin-sla-breach", {
      type: "admin_custom",
      to: adminEmail,
      orderNumber: fresh[0].orderNumber,
      customerName: "Admin",
      customSubject: `${fresh.length} sipariş 24 saattir üreticiden yanıt bekliyor`,
      customBody:
        `Aşağıdaki siparişlerde atanan üretici 24 saat içinde kabul/ret vermedi:\n\n` +
        fresh
          .map((o) => `- ${o.orderNumber} — ${o.companyName ?? "?"}`)
          .join("\n") +
        `\n\nAdmin sipariş sayfasındaki "Atamayı geri al / başka üreticiye ver" bloğundan devredebilirsiniz.`,
      locale: "tr",
    })
    .catch((e) => console.error("SLA admin email enqueue failed", e));

  job.log(`Flagged ${fresh.length} stale assignments`);
}

export function startAssignmentSlaWorker() {
  const worker = new Worker("assignment-sla", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    console.info(`assignment-sla completed: ${job.id}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`assignment-sla failed: ${job?.id}`, err);
  });

  return worker;
}
