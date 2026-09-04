/**
 * Atölye seansı kapanış süpürmesi — saatte bir.
 *
 * Dört iş yapar, bu sırayla:
 *
 *  1. SÜRESİ DOLMUŞ KOLTUK TUTMALARI — ödemesi `WORKSHOP_SEAT_HOLD_HOURS`
 *     içinde gelmemiş rezervasyonları `expireDraft` ile sonlandırır (Task 10'un
 *     bırakma yolu; ikinci bir sayaç düşürme YOK). Koltuk sızıntısının gerçek
 *     kurtarması budur: katılım, süre dolumu işini işlemden SONRA kuyruğa alır
 *     ve Redis erişilemezse katılımı yine de başarılı sayar — o iş hiç
 *     yazılmazsa koltuğu geri verecek başka hiçbir şey yoktur. Sayaç mutabakatı
 *     bunu göremez, çünkü katılımcı satırı `pending_payment` olarak durduğu için
 *     sayaç zaten "doğru"dur.
 *
 *  2. MUTABAKAT — açık seansların koltuk sayacını katılımcı satırlarıyla
 *     karşılaştırır. Yukarıdaki sızıntıyı DEĞİL, iki tarafı ayrı ayrı yazan
 *     yolların (elle DB müdahalesi, katılımcıyı iptal etmeden sayacı düşüren bir
 *     çağrı, ileride eklenecek bir yol) açtığı sapmayı kapatır. Tutmalardan
 *     SONRA, kapanıştan ÖNCE koşar: kapanan seans doğru sayaçla tarihe geçsin.
 *
 *  3. KAPANIŞ — katılım penceresi dolmuş seansları kapatır: sipariş adedi
 *     sabitlenir, komisyon oranı merdivenden hesaplanıp DONDURULUR ve parti ön
 *     rezerve üreticiye düşer. Kimse izlemezse seans sonsuza kadar açık kalır ve
 *     ödenmiş siparişler üretime hiç girmez.
 *
 *  4. ÖKSÜZ SAHİPLENME — kapanıştan SONRA ödemesi tamamlanan siparişleri hâlâ
 *     üretimdeki partiye alır. Koltuk kapanışa kadar rezerve edilebildiği ve
 *     taslak 6 saat yaşadığı için bu pencere gerçek: sahiplenilmezse müşteri
 *     ödemiş ama figürü hiç basılmamış olur. Kapanıştan SONRA koşar ki bu turda
 *     kapanan seansların siparişleri zaten atanmış olsun.
 *
 * Dayanıklılık: bir seansın patlaması süpürmenin geri kalanına mal olmamalı —
 * her seans kendi try/catch'inde işlenir, biriken hatalar sonunda TEK seferde
 * bildirilir (model-approval-sla süpürmesinin aynı kalıbı).
 */
import { Worker, Job } from "bullmq";
import { getRedisConnection } from "../connection";
import {
  adoptOrphanBatchOrders,
  closeSession,
  findSessionsDueToClose,
  findStaleSeatHolds,
  reconcileOpenSessionSeats,
} from "../../services/workshop-session";
import { expireDraft } from "../../services/order-draft";

async function processJob(job: Job) {
  const failures: string[] = [];

  // Süresi dolmuş tutmalar. `expireDraft` idempotenttir (taslak `pending`
  // değilse erken döner) ve koltuğu Task 10'un koşullu UPDATE'i üzerinden
  // bırakır — süre dolumu işi çoktan çalışmışsa ikinci bir düşürme OLMAZ.
  let expiredHolds = 0;
  try {
    const stale = await findStaleSeatHolds(new Date());
    for (const hold of stale) {
      if (!hold.draftId) {
        // Taslaksız bir katılımcının koltuğunu bırakmanın güvenli yolu yok:
        // `releaseSeatForDraft` taslak üzerinden yürüyor, elle düşürmek ise
        // ikinci bir sayaç yolu açardı. Admin'e bırakılır.
        //
        // Bu satır SONSUZA KADAR tekrarlanmaz: `findStaleSeatHolds` taslaksız
        // tutmaları `WORKSHOP_ORPHAN_HOLD_REPORT_DAYS` ile sınırlıyor (bkz. o
        // fonksiyonun yorumu) — bir hafta bildirilir, sonra susar.
        console.error(
          `[workshop-close] katılımcı ${hold.participantId} (seans ${hold.sessionId}) ` +
            `taslaksız ve ${hold.heldSince.toISOString()}'ten beri ödeme bekliyor — ` +
            `koltuk elle bırakılmalı`
        );
        continue;
      }
      try {
        await expireDraft(hold.draftId);
        expiredHolds++;
        await job.log(`stale seat hold expired: draft ${hold.draftId} (seans ${hold.sessionId})`);
      } catch (err) {
        const message = (err as Error).message;
        console.error(`[workshop-close] taslak ${hold.draftId} sonlandırılamadı: ${message}`);
        failures.push(`taslak ${hold.draftId}: ${message}`);
      }
    }
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[workshop-close] süresi dolmuş tutmalar taranamadı: ${message}`);
    failures.push(`tutma taraması: ${message}`);
  }

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

  // Bu adım da kendi try/catch'inde: geçici bir DB hatası işi burada
  // düşürürse öksüz sahiplenme hiç koşmaz ve "her adım bağımsız" sözü bozulur.
  let due: Awaited<ReturnType<typeof findSessionsDueToClose>> = [];
  try {
    due = await findSessionsDueToClose(new Date());
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[workshop-close] kapanacak seanslar taranamadı: ${message}`);
    failures.push(`kapanış taraması: ${message}`);
  }
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

  // Sahiplenme de kapanışı ENGELLEMEZ: kapanmış partiler zaten yazıldı.
  let adopted = 0;
  try {
    const adoptions = await adoptOrphanBatchOrders();
    adopted = adoptions.reduce((n, a) => n + a.orderIds.length, 0);
    for (const a of adoptions) {
      await job.log(
        `orphan adopt ${a.sessionId}: ${a.orderIds.length} sipariş, komisyon ${a.commissionRateBps}bps`
      );
    }
  } catch (err) {
    const message = (err as Error).message;
    console.error(`[workshop-close] öksüz sipariş sahiplenme başarısız: ${message}`);
    failures.push(`öksüz sahiplenme: ${message}`);
  }

  await job.log(
    `swept ${due.length} due session(s): ${closed} closed, ` +
      `${expiredHolds} stale seat hold(s) expired, ${reconciled} seat count(s) reconciled, ` +
      `${adopted} orphan order(s) adopted, ${failures.length} failed`
  );

  // Her seans işlendikten SONRA bildirilir: hata kuyrukta görünsün ama
  // süpürmeyi yarıda kesmesin.
  if (failures.length > 0) {
    throw new Error(
      `workshop-close: ${failures.length} failure(s) — ${failures.join(" | ")}`
    );
  }

  return { scanned: due.length, closed, expiredHolds, reconciled, adopted };
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
