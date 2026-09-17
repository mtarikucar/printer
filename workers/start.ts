import "dotenv/config";
import "./instrument";
import { startEmailWorker } from "../src/lib/queue/workers/email.worker";
import { startPreviewGenerationWorker } from "../src/lib/queue/workers/preview-generation.worker";
import { startPreviewCleanupWorker } from "../src/lib/queue/workers/preview-cleanup.worker";
import { startPaymentDeadlineWorker } from "../src/lib/queue/workers/payment-deadline.worker";
import { startDekontOcrWorker } from "../src/lib/queue/workers/dekont-ocr.worker";
import { startScoringEvaluationsCleanupWorker } from "../src/lib/queue/workers/scoring-evaluations-cleanup.worker";
import { startNotificationWorker } from "../src/lib/queue/workers/notification.worker";
import { startAnalyticsCleanupWorker } from "../src/lib/queue/workers/analytics-cleanup.worker";
import { startAssignmentSlaWorker } from "../src/lib/queue/workers/assignment-sla.worker";
import { startModelGenerationWorker } from "../src/lib/queue/workers/model-generation.worker";
import { startMeshProcessingWorker } from "../src/lib/queue/workers/mesh-processing.worker";
import { startWhatsAppOutboundWorker } from "../src/lib/queue/workers/whatsapp-outbound.worker";
import { startWaInboundWorker } from "../src/lib/queue/workers/wa-inbound.worker";
import { startWaAgentWorker } from "../src/lib/queue/workers/wa-agent.worker";
import { startModelApprovalSlaWorker } from "../src/lib/queue/workers/model-approval-sla.worker";
import { startWorkshopCloseWorker } from "../src/lib/queue/workers/workshop-close.worker";
import { startPainterAcceptSlaWorker } from "../src/lib/queue/workers/painter-accept-sla.worker";
import { startManufacturerAcceptSlaWorker } from "../src/lib/queue/workers/manufacturer-accept-sla.worker";
import {
  getPreviewCleanupQueue,
  getScoringEvaluationsCleanupQueue,
  getAnalyticsCleanupQueue,
  getAssignmentSlaQueue,
  getManufacturerAcceptSlaQueue,
  getModelApprovalSlaQueue,
  getWorkshopCloseQueue,
  getPainterAcceptSlaQueue,
  getEmailQueue,
} from "../src/lib/queue/queues";

console.log("Starting BullMQ workers...");

const emailWorker = startEmailWorker();
// Refund intent remains on its DB record through Redis loss, retained jobs and
// worker crashes. Use the existing email worker for the bounded recovery sweep.
getEmailQueue().upsertJobScheduler(
  "refund-record-email-recovery",
  { every: 60_000 },
  { name: "refund_record_email_recover", data: { type: "refund_record_email_recover" },
    opts: { attempts: 1, removeOnComplete: true, removeOnFail: 20 } }
).catch((error) => console.error("Refund email recovery registration failed", error));
getEmailQueue().upsertJobScheduler(
  "refund-record-analytics-recovery",
  { every: 60_000 },
  { name: "refund_record_analytics_recover", data: { type: "refund_record_analytics_recover" },
    opts: { attempts: 1, removeOnComplete: true, removeOnFail: 20 } }
).catch((error) => console.error("Refund analytics recovery registration failed", error));
const previewWorker = startPreviewGenerationWorker();
const cleanupWorker = startPreviewCleanupWorker();
const paymentDeadlineWorker = startPaymentDeadlineWorker();
const dekontOcrWorker = startDekontOcrWorker();
const scoringEvalCleanupWorker = startScoringEvaluationsCleanupWorker();
const notificationWorker = startNotificationWorker();
const analyticsCleanupWorker = startAnalyticsCleanupWorker();
const assignmentSlaWorker = startAssignmentSlaWorker();
// Auto-3D: Meshy generation (short API calls, self-re-enqueuing) and mesh
// processing (python, CPU-bound, concurrency 1).
const modelGenerationWorker = startModelGenerationWorker();
const meshProcessingWorker = startMeshProcessingWorker();
// WhatsApp channel. Both are inert until platform_flags.wa_bot_enabled is on.
const whatsappOutboundWorker = startWhatsAppOutboundWorker();
const waInboundWorker = startWaInboundWorker();
// Inert until platform_flags.wa_agent_enabled is on AND ANTHROPIC_API_KEY is set.
const waAgentWorker = startWaAgentWorker();
// A paid order parked in `awaiting_customer_approval` prints nothing until
// somebody decides; this sweeper is that somebody.
const modelApprovalSlaWorker = startModelApprovalSlaWorker();
// Katılım penceresi kapanan atölye seanslarını kapatan, komisyon oranını
// donduran ve partiyi üreticiye düşüren süpürme. Aynı iş, açık seansların
// koltuk sayacını katılımcı satırlarıyla mutabakata getirir.
const workshopCloseWorker = startWorkshopCloseWorker();
// Boyacıya atanan iş 24 saat yanıtsız kalırsa: OTOMATİK atanmışsa sıradaki
// boyacıya devredilir (ceza yok, yeniden yerleştirme sınırına sayılır: üç
// yeniden yerleştirme hakkı vardır, yani sınır DÖRDÜNCÜ rette tükenir —
// config/flags.ts · PAINTER_MAX_DECLINES), elle atanmışsa yalnız bayraklanır.
// Üretici ikizi (assignment-sla) hiçbir işi taşımaz.
const painterAcceptSlaWorker = startPainterAcceptSlaWorker();
// Üreticiye atanan iş 24 saat yanıtsız kalırsa: OTOMATİK atanmışsa sıradaki
// atölyeye devredilir (ceza yok, yeniden yerleştirme sınırına sayılır —
// config/flags.ts · MANUFACTURER_MAX_DECLINES), elle atanmışsa / satıcının kendi
// ürünüyse / iş yola çıkmışsa yalnız bayraklanır. Boyacı ikizinin (
// painter-accept-sla) üretici tarafındaki karşılığı.
const manufacturerAcceptSlaWorker = startManufacturerAcceptSlaWorker();

// Schedule repeatable cleanup job (every hour)
getPreviewCleanupQueue().upsertJobScheduler(
  "preview-cleanup-hourly",
  { every: 3600000 },
  { name: "preview-cleanup" }
);

// Q7: drop manufacturer_assignment_evaluations older than 30d, daily.
getScoringEvaluationsCleanupQueue().upsertJobScheduler(
  "scoring-evaluations-cleanup-daily",
  { every: 24 * 3600 * 1000 },
  { name: "scoring-evaluations-cleanup" }
);

// Analytics retention: drop analytics_events older than the retention window
// (default 180d), daily, so the funnel log doesn't grow unbounded.
getAnalyticsCleanupQueue().upsertJobScheduler(
  "analytics-cleanup-daily",
  { every: 24 * 3600 * 1000 },
  { name: "analytics-cleanup" }
);

// ESKİ BAYRAK-ONLY SÜPÜRMESİ EMEKLİ EDİLDİ (Faz 5).
//
// `assignment-sla` aynı kümeyi (24 saattir yanıtlanmamış atamalar) tarayıp
// yalnız [SLA] notu yazıyor ve admin'e e-posta atıyordu. Yerini alan
// `manufacturer-accept-sla` aynı kümeyi tarıyor, OTOMATİK atanmış işi devrediyor
// ve devredemediğini yine bayraklıyor — yani eski süpürmenin yaptığı her şeyi
// kapsıyor. İKİSİ BİRDEN ZAMANLANSAYDI admin tek bir olay için iki ayrı e-posta
// ve iki ayrı not alırdı; üstelik eski süpürme, yeni süpürme işi devretmeden
// önce "24 saattir yanıt bekliyor" diye haber verip hemen bayatlayabilirdi.
//
// Zamanlayıcı Redis'te KALICIDIR: `upsertJobScheduler` çağrısını silmek, daha
// önce yazılmış zamanlayıcıyı durdurmaz — bu yüzden açıkça kaldırılıyor. Worker
// yine de ayakta tutuluyor (yukarıda): kuyrukta bekleyen ya da elle eklenmiş bir
// iş varsa sahipsiz kalmasın.
getAssignmentSlaQueue()
  .removeJobScheduler("assignment-sla-hourly")
  .then((removed) => {
    if (removed) {
      console.info(
        "assignment-sla-hourly zamanlayıcısı kaldırıldı (yerini manufacturer-accept-sla aldı)"
      );
    }
  })
  .catch((e) =>
    console.error("assignment-sla-hourly zamanlayıcısı kaldırılamadı", e)
  );

// Üreticinin 24 saatlik kabul süresini saatlik ölç: süresi dolan OTOMATİK
// atamayı sıradaki atölyeye devret, kalanını admin için bayrakla.
getManufacturerAcceptSlaQueue().upsertJobScheduler(
  "manufacturer-accept-sla-hourly",
  { every: 3600000 },
  { name: "manufacturer-accept-sla" }
);

// 48h auto-approve (only a clean `pass`), 72h customer reminder, 7d admin
// escalation. DB-backed scheduler so it survives a Redis restart.
getModelApprovalSlaQueue().upsertJobScheduler(
  "model-approval-sla-6h",
  { every: 6 * 3600 * 1000 },
  { name: "model-approval-sla" }
);

// Kapanış zamanı geçen seansları saatlik kapat, oranı dondur, partiyi ata.
getWorkshopCloseQueue().upsertJobScheduler(
  "workshop-close-hourly",
  { every: 3600000 },
  { name: "workshop-close" }
);

// Boyacının 24 saatlik kabul süresini saatlik ölç: süresi dolan OTOMATİK
// atamayı sıradaki boyacıya devret, kalanını admin için bayrakla.
getPainterAcceptSlaQueue().upsertJobScheduler(
  "painter-accept-sla-hourly",
  { every: 3600000 },
  { name: "painter-accept-sla" }
);

console.log("All workers started:");
console.log("  - email (concurrency: 5)");
console.log("  - preview-generation (concurrency: 3)");
console.log("  - preview-cleanup (repeatable: every 1h)");
console.log("  - payment-deadline (concurrency: 2)");
console.log("  - dekont-ocr (concurrency: 2)");
console.log("  - scoring-evaluations-cleanup (repeatable: every 24h)");
console.log("  - notification (concurrency: 5)");
console.log("  - analytics-cleanup (repeatable: every 24h)");
console.log("  - assignment-sla (emekli: zamanlayıcı yok, yerini manufacturer-accept-sla aldı)");
console.log("  - manufacturer-accept-sla (repeatable: every 1h)");
console.log("  - model-generation (concurrency: 4, meshy)");
console.log("  - mesh-processing (concurrency: 1, python)");
console.log("  - wa-outbound (concurrency: 4, 40/min)");
console.log("  - wa-inbound (concurrency: 4)");
console.log("  - wa-agent (concurrency: 4, 30/min, attempts: 1)");
console.log("  - model-approval-sla (repeatable: every 6h)");
console.log("  - workshop-close (repeatable: every 1h)");
console.log("  - painter-accept-sla (repeatable: every 1h)");

async function shutdown() {
  console.log("Shutting down workers...");
  await Promise.all([
    emailWorker.close(),
    previewWorker.close(),
    cleanupWorker.close(),
    paymentDeadlineWorker.close(),
    dekontOcrWorker.close(),
    scoringEvalCleanupWorker.close(),
    notificationWorker.close(),
    analyticsCleanupWorker.close(),
    assignmentSlaWorker.close(),
    modelGenerationWorker.close(),
    meshProcessingWorker.close(),
    whatsappOutboundWorker.close(),
    waInboundWorker.close(),
    waAgentWorker.close(),
    modelApprovalSlaWorker.close(),
    workshopCloseWorker.close(),
    painterAcceptSlaWorker.close(),
    manufacturerAcceptSlaWorker.close(),
  ]);
  console.log("Workers shut down gracefully");
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
