/**
 * Atölye seansı kapanış süpürmesi — saatte bir.
 *
 * İki iş yapar, bu sırayla:
 *
 *  1. MUTABAKAT — açık seansların koltuk sayacını gerçek katılımcı satırlarından
 *     yeniden kurar. Koltuk rezervasyonu ile katılımcı satırı tek işlemde doğuyor
 *     (Task 8), ama koltuğu geri veren yol Redis'e bağlı: süre dolumu işi hiç
 *     kuyruğa yazılamazsa o koltuk kimsenin kurtaramayacağı şekilde tutulu kalır.
 *     Kapanıştan ÖNCE koşar ki kapanan seans doğru sayaçla tarihe geçsin.
 *
 *  2. KAPANIŞ — katılım penceresi dolmuş seansları kapatır: sipariş adedi
 *     sabitlenir, komisyon oranı merdivenden hesaplanıp DONDURULUR ve parti ön
 *     rezerve üreticiye düşer. Kimse izlemezse seans sonsuza kadar açık kalır ve
 *     ödenmiş siparişler üretime hiç girmez.
 *
 * Dayanıklılık: bir seansın patlaması süpürmenin geri kalanına mal olmamalı —
 * her seans kendi try/catch'inde işlenir, biriken hatalar sonunda TEK seferde
 * bildirilir (model-approval-sla süpürmesinin aynı kalıbı).
 */
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import {
  closeSession,
  findSessionsDueToClose,
  reconcileOpenSessionSeats,
} from "../../services/workshop-session";

async function processJob(job: Job) {
  const failures: string[] = [];

  // Mutabakat kapanışı ENGELLEMEZ: sayaç düzeltmesi başarısız olsa bile
  // kapanmayı bekleyen seanslar kapanmalı.
  let reconciled = 0;
  try {
    const corrections = await reconcileOpenSessionSeats();
    reconciled = corrections.length;
    for (const c of corrections) {
      await job.log(`seat reconcile ${c.sessionId}: ${c.from} → ${c.to}`);
    }
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[workshop-close] koltuk mutabakatı başarısız: ${message}`);
    failures.push(`koltuk mutabakatı: ${message}`);
  }

  const due = await findSessionsDueToClose(new Date());
  let closed = 0;

  for (const session of due) {
    try {
      const result = await closeSession(session.id);
      if ("error" in result) {
        // İdempotens: aynı seansı bir başka süpürme çoktan kapatmış olabilir.
        await job.log(`session ${session.id}: atlandı — ${result.error}`);
        continue;
      }
      closed++;
      await job.log(
        `session ${session.id}: ${result.orderCount} sipariş, komisyon ${result.commissionRateBps}bps`
      );
    } catch (err) {
      const message = (err as Error).message;
      console.error(`[workshop-close] session ${session.id} failed: ${message}`);
      failures.push(`${session.id}: ${message}`);
    }
  }

  await job.log(
    `swept ${due.length} due session(s): ${closed} closed, ` +
      `${reconciled} seat count(s) reconciled, ${failures.length} failed`
  );

  // Her seans işlendikten SONRA bildirilir: hata kuyrukta görünsün ama
  // süpürmeyi yarıda kesmesin.
  if (failures.length > 0) {
    throw new Error(
      `workshop-close: ${failures.length} failure(s) — ${failures.join(" | ")}`
    );
  }

  return { scanned: due.length, closed, reconciled };
}

export function startWorkshopCloseWorker(): Worker {
  const worker = new Worker("workshop-close", processJob, {
    connection: getRedisConnection(),
    concurrency: 1,
  });

  worker.on("completed", (job) => {
    console.info(`workshop-close completed: ${job.id}`);
  });
  worker.on("failed", (job, err) => {
    console.error(`workshop-close failed: ${job?.id}`, err);
  });

  return worker;
}
