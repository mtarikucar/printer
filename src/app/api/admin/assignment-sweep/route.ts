import { NextRequest, NextResponse } from "next/server";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { autoAssignRowGate } from "@/lib/config/flags";
import { db } from "@/lib/db";
import { adminActions, manufacturers } from "@/lib/db/schema";
import {
  ASSIGN_FAILURE_MESSAGES,
  assignManufacturerToOrder,
  orderHasPrintableContent,
} from "@/lib/services/manufacturer-assign";
import {
  commitAssignmentEvaluation,
  discardAssignmentEvaluation,
  rankForOrderWithShadow,
} from "@/lib/services/manufacturer-assignment-shadow";
import {
  GATE_BLOCK_TR,
  SELLER_BLOCKED_TR,
  SELLER_MISMATCH_TR,
  SELLER_SHOP_UNAVAILABLE_TR,
  countPendingSweepOrders,
  evaluateSweepOrders,
  loadAutoAssignSwitches,
  loadPendingSweepOrders,
  loadSweepOrderById,
  noCandidateMessage,
  sweepPlacementPlan,
} from "@/app/admin/assignment-sweep/sweep-data";
import {
  SWEEP_APPLY_BATCH,
  SWEEP_DEFAULT_LIMIT,
  SWEEP_KIND_LABEL_TR,
  SWEEP_MAX_LIMIT,
  type SweepApplyResponse,
  type SweepApplyResult,
  type SweepDryRunResponse,
} from "@/app/admin/assignment-sweep/types";

/**
 * Atama taraması — tek seferlik "birikeni erit" ucu.
 *
 * GET  = KURU TARAMA. Hiçbir şey yazmaz: üretici bekleyen siparişleri listeler
 *        ve her biri için bugünün sıralamasına göre adayı, skor kırılımını ya
 *        da atanamama gerekçesini döner.
 * POST = admin'in EKRANDA ONAYLADIĞI siparişleri uygular.
 *
 * Kapalı anahtar (sipariş türünün otomatik ataması kapalı) burada SESSİZCE
 * yok sayılmaz: böyle bir sipariş ancak admin `allowAutoAssignOff` ile ayrıca
 * onaylarsa atanır ve atamanın yanına "anahtar kapalıyken elle atandı" denetim
 * satırı düşer. Anahtarı kapatmanın tek anlamı "bu türü sistem kendiliğinden
 * dağıtmasın"dır; iki tıkla toplu atamaya dönüşürse anahtar anlamsız kalırdı.
 *
 * Neden `autoAssignIfEligible` değil de doğrudan `assignManufacturerToOrder`:
 *  1. Tarama elle onaylanan bir işlemdir; admin ayrıca onayladığında anahtarı
 *     kapalı bir türün siparişi de temizlenebilmelidir. `autoAssignIfEligible`
 *     anahtarı okur ve kapalıysa `flag_off` ile çıkardı — sahibinin onayladığı
 *     atama sessizce yapılmazdı.
 *  2. Uygulama, admin'in GÖRDÜĞÜ adayı doğrular: yeniden sıralar ve kazanan
 *     değiştiyse atamaz. Onaylanmamış bir üreticiye sipariş göndermemenin tek
 *     yolu bu karşılaştırmadır.
 * Atamanın kendisi yine tek ortak servisten geçer (atomik güncelleme, denetim
 * satırı, üretici bildirimi, SSE yayını), yani elle atama ile aynı yoldur.
 *
 * PAZARYERİ KURALI: satıcının kendi kataloğundan çıkan sipariş yalnız kendi
 * atölyesine atanabilir. Hem tarama hem uygulama bu kararı otomatik atamanın
 * saf kuralından (`sweepPlacementPlan` → `autoAssignPlacementPlan`) okur;
 * uygulama ayrıca ekrandan gelen üreticinin GERÇEKTEN satıcının atölyesi
 * olduğunu doğrular.
 */

/**
 * İstek süresi bütçesi (saniye).
 *
 * Tek kuru tarama 25 siparişi sıralayabilir ve her sıralama üretici başına
 * birkaç indeksli sorgu demek; uygulama adımı ise sipariş başına sıralama +
 * bildirim + denetim satırı çalıştırır. Varsayılan (kısa) sınırda yavaş bir
 * veritabanında istek platform tarafından kesilir ve admin hangi siparişin
 * atandığını göremez. Değer LİTERAL yazılmalıdır: Next segment ayarlarını
 * statik olarak okur, içe aktarılan bir sabit çalışmaz. İstemcinin kendi
 * zaman aşımı bu bütçenin biraz üstündedir (client.tsx).
 */
export const maxDuration = 60;

function parseLimit(raw: string | null): number {
  const parsed = raw ? Number.parseInt(raw, 10) : Number.NaN;
  if (!Number.isFinite(parsed) || parsed <= 0) return SWEEP_DEFAULT_LIMIT;
  return Math.min(parsed, SWEEP_MAX_LIMIT);
}

export async function GET(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const limit = parseLimit(request.nextUrl.searchParams.get("limit"));

  try {
    const switches = await loadAutoAssignSwitches();
    const [total, pending] = await Promise.all([
      countPendingSweepOrders(),
      loadPendingSweepOrders(limit, switches),
    ]);
    const rows = await evaluateSweepOrders(pending);

    const payload: SweepDryRunResponse = {
      scannedAt: new Date().toISOString(),
      total,
      limit,
      rows,
    };
    return NextResponse.json(payload);
  } catch (error: unknown) {
    console.error("[ATAMA taraması] kuru tarama hata verdi:", error);
    return NextResponse.json(
      { error: "Tarama yapılamadı. Tekrar deneyin." },
      { status: 500 }
    );
  }
}

// Kimlikler biçim olarak doğrulanır (guid): bozuk bir kimlik Postgres'e kadar
// gidip 500 döndürmesin. Mesajların hepsi Türkçe, çünkü istemci `error`
// alanını olduğu gibi gösterir.
const applySchema = z.object(
  {
    items: z
      .array(
        z.object({
          orderId: z
            .string({ error: "Geçersiz sipariş kimliği." })
            .guid({ error: "Geçersiz sipariş kimliği." }),
          manufacturerId: z
            .string({ error: "Geçersiz üretici kimliği." })
            .guid({ error: "Geçersiz üretici kimliği." }),
        }),
        { error: "Sipariş seçimi zorunludur." }
      )
      .min(1, { error: "En az bir sipariş seçin." })
      // Tek istekte küçük bir grup: her atama yeniden sıralama + bildirim +
      // denetim satırı demek. İstemci seçimi bu boyda gruplara böler ve her
      // grubun sonucunu ayrı gösterir, böylece yarıda kalan bir istek yalnız
      // kendi siparişlerini belirsiz bırakır.
      .max(SWEEP_APPLY_BATCH, {
        error: `Tek istekte en fazla ${SWEEP_APPLY_BATCH} sipariş atanabilir.`,
      }),
    // Kapalı otomatik atama anahtarına sahip türleri de atamak için admin'in
    // ekranda ayrıca işaretlediği onay. Varsayılan false: eksik gönderilen bir
    // istek kapalı anahtarı AŞAMAZ.
    allowAutoAssignOff: z.boolean({ error: "Geçersiz onay değeri." }).optional(),
  },
  { error: "Geçersiz istek." }
);

export async function POST(request: NextRequest) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const parsed = applySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek." },
      { status: 400 }
    );
  }

  // Aynı sipariş iki kez gönderilirse ilki geçerlidir: ikinci deneme zaten
  // "atanmış" diye elenirdi, ama admin'e iki satır sonuç göstermenin anlamı yok.
  const items = [
    ...new Map(parsed.data.items.map((i) => [i.orderId, i])).values(),
  ];

  const allowAutoAssignOff = parsed.data.allowAutoAssignOff === true;
  // Anahtarlar istek başına BİR kez okunur ve ekrandan gelen değere
  // güvenilmez: tarama ile onay arasında bir anahtar kapatılmış olabilir.
  const switches = await loadAutoAssignSwitches();

  const results: SweepApplyResult[] = [];

  // Sırayla: her atama bildirim ve gerçek zamanlı yayın tetikler, 50 siparişi
  // paralel işlemek ne hızlandırır ne de güvenlidir.
  for (const item of items) {
    // Bu sipariş için SIRALAMA çalıştırıldı mı. Döngü gövdesinin en dışında
    // durur ki `catch` de görsün: beklemedeki değerlendirme taslağı bellekte
    // kalırsa 2,5 sn'lik gecikmeli doğrulama, bu arada BAŞKASININ yaptığı
    // atamayı bizim sıralamamızın kararıymış gibi kaydeder.
    let ranked = false;
    try {
      const pending = await loadSweepOrderById(item.orderId, switches);
      if (!pending) {
        results.push({
          orderId: item.orderId,
          orderNumber: null,
          ok: false,
          manufacturerName: null,
          message: "Sipariş bulunamadı.",
        });
        continue;
      }

      const { base, shape } = pending;
      const push = (
        ok: boolean,
        message: string,
        manufacturerName: string | null = null,
        rescan = false
      ) =>
        results.push({
          orderId: base.orderId,
          orderNumber: base.orderNumber,
          ok,
          manufacturerName,
          message,
          rescan,
        });

      // Kapalı anahtar: ayrı onay olmadan atanmaz. Ekran bu satırları seçili
      // getirmez; buradaki kontrol, isteği elle kuran birinin (ya da bayat bir
      // sekmenin) anahtarı aşmasını da engeller.
      if (!base.autoAssignEnabled && !allowAutoAssignOff) {
        push(
          false,
          `Bu türün otomatik atama anahtarı kapalı (${SWEEP_KIND_LABEL_TR[base.kind]}). Atamak için onay adımındaki "anahtarı kapalı türleri de ata" kutusunu işaretleyin.`
        );
        continue;
      }

      // Taramadaki sıranın aynısı: satır kapısı (atölye / iade / "onaylı +
      // atanmamış") → basılabilir içerik → sıralama. Kapıya `flagEnabled = true`
      // geçilir çünkü anahtar kontrolü yukarıda, admin'in onayıyla birlikte
      // yapıldı; atölye yine kapıda elenir (anahtarı yoktur).
      const gate = autoAssignRowGate(shape, true);
      if (gate) {
        // Sipariş tarama ile onay arasında değiştiyse ekran bayatlamıştır.
        push(false, GATE_BLOCK_TR[gate], null, gate === "not_eligible");
        continue;
      }

      if (!(await orderHasPrintableContent(base.orderId))) {
        push(false, ASSIGN_FAILURE_MESSAGES.no_printable_content);
        continue;
      }

      // MÜLKİYET sıralamadan önce: satıcının kendi ürünü rakip atölyeye
      // gidemez. Karar taramadaki ile AYNI saf kuraldan gelir; ekrandan gelen
      // üreticiye de güvenilmez, satıcının atölyesiyle karşılaştırılır.
      const plan = sweepPlacementPlan(pending);
      if (plan.kind === "skip") {
        push(false, SELLER_BLOCKED_TR, null, true);
        continue;
      }

      let targetManufacturerId: string;
      let targetName: string;

      if (plan.kind === "seller") {
        if (item.manufacturerId !== plan.manufacturerId) {
          push(false, SELLER_MISMATCH_TR, null, true);
          continue;
        }
        // Satıcı yolunda SIRALAMA YOKTUR (canlı otomatik atama da sıralamaz):
        // ad yalnız sonuç satırını yazabilmek için okunur.
        const [shop] = await db
          .select({ companyName: manufacturers.companyName })
          .from(manufacturers)
          .where(eq(manufacturers.id, plan.manufacturerId))
          .limit(1);
        if (!shop) {
          push(false, SELLER_SHOP_UNAVAILABLE_TR, null, true);
          continue;
        }
        targetManufacturerId = plan.manufacturerId;
        targetName = shop.companyName;
      } else {
        // Uygulama anında gölge sarmalayıcısı: bu GERÇEK bir atama kararıdır, o
        // yüzden değerlendirme satırı da düşmelidir (Faz 1: kayıt yalnızca atama
        // yolunda). Sarmalayıcı satırı HEMEN yazmaz, beklemede bir taslak
        // bırakır: aşağıdaki her çıkış ya taslağı işler (yerleştirme oldu) ya da
        // düşürür (olmadı).
        ranked = true;
        const candidates = await rankForOrderWithShadow(base.orderId);
        const best = candidates.find((c) => c.eligible);
        if (!best) {
          // Ekranda aday görünüyordu, şimdi hiçbiri uygun değil: tablo bayat.
          // Sıraladık ama hiçbir işi YERLEŞTİRMEDİK — taslak düşer, yoksa bu
          // sırada siparişi atayan başka bir yolun kararı bizim sıralamamızın
          // sonucu gibi kaydedilirdi.
          discardAssignmentEvaluation(base.orderId);
          push(false, noCandidateMessage(candidates), null, true);
          continue;
        }

        if (best.manufacturerId !== item.manufacturerId) {
          // Tarama ile onay arasında bir şey değişti (yeni sipariş, dolan
          // kapasite, kapatılan atölye). Admin'in görmediği üreticiye sipariş
          // göndermeyiz — ve vazgeçtiğimiz için ortada kaydedilecek bir karar
          // da yoktur.
          discardAssignmentEvaluation(base.orderId);
          push(
            false,
            `Aday değişti: en uygun üretici artık ${best.companyName}. Taramayı yenileyip tekrar onaylayın.`,
            null,
            true
          );
          continue;
        }
        targetManufacturerId = best.manufacturerId;
        targetName = best.companyName;
      }

      const result = await assignManufacturerToOrder({
        orderId: base.orderId,
        manufacturerId: targetManufacturerId,
        // Denetim satırı bu e-postayla düşer — taramayla yapılan atama da
        // elle yapılan atama gibi kime ait olduğu belli bir işlemdir.
        adminEmail: a.session.user.email,
        // Hemen yukarıda kanıtlandı; sıralayıcı da aynı siparişi okudu.
        skipPrintableCheck: true,
        notification: {
          subject: `Yeni sipariş atandı: ${base.orderNumber}`,
          body: `${base.orderNumber} numaralı sipariş size atandı.\n\nÜretici panelinizden 24 saat içinde kabul veya reddedin.`,
        },
      });

      if (!result.ok) {
        // Yarışı kaybettik ya da sipariş artık atanabilir değil: BİZİM
        // verdiğimiz bir karar yok, beklemedeki taslak düşer.
        if (ranked) discardAssignmentEvaluation(base.orderId);
        // `not_assignable` = sipariş artık bu durumda değil: ekran bayat.
        push(
          false,
          ASSIGN_FAILURE_MESSAGES[result.reason],
          targetName,
          result.reason === "not_assignable"
        );
        continue;
      }

      // Korumalı UPDATE geçti: kararı yaratan sıralama ile kararın kendisi
      // ancak BURADA birbirine bağlanır. Satırı 2,5 sn'lik gecikmeli
      // doğrulamaya bırakmıyoruz: o zamanlayıcı unref'li ve yalnız siparişin
      // KENDİ satırına bakar, yani "bu atamayı biz mi yaptık" sorusunu soramaz.
      if (ranked) await commitAssignmentEvaluation(base.orderId, targetManufacturerId);

      if (!base.autoAssignEnabled) {
        // Anahtar kapalıyken yapılan atama ayrıca iz bırakır: servisin kendi
        // "assign_manufacturer" satırı bunu söylemez, oysa sonradan "bu iş
        // buraya nasıl gitti" sorusunun cevabı tam olarak budur. Denetim
        // satırının yazılamaması atamayı geri almaz.
        await db
          .insert(adminActions)
          .values({
            orderId: base.orderId,
            action: "assign_manufacturer",
            adminEmail: a.session.user.email,
            notes: `Otomatik atama anahtarı KAPALI (${SWEEP_KIND_LABEL_TR[base.kind]}) — admin atama taramasından ayrıca onaylayarak ${targetName} üreticisine atadı.`,
          })
          .catch((e) =>
            console.error("[ATAMA taraması] kapalı anahtar denetim satırı yazılamadı", e)
          );
      }

      push(true, `${targetName} üreticisine atandı.`, targetName);
    } catch (error: unknown) {
      // Sıraladıktan sonra patladıysak da taslak düşmeli: atamanın gerçekten
      // yazılıp yazılmadığını bilmiyoruz, bilinmeyeni karar diye kaydetmeyiz.
      if (ranked) discardAssignmentEvaluation(item.orderId);
      console.error(`[ATAMA taraması] ${item.orderId} atanamadı:`, error);
      results.push({
        orderId: item.orderId,
        orderNumber: null,
        ok: false,
        manufacturerName: null,
        message: "Atama sırasında beklenmeyen bir hata oluştu.",
      });
    }
  }

  const payload: SweepApplyResponse = {
    assigned: results.filter((r) => r.ok).length,
    skipped: results.filter((r) => !r.ok).length,
    results,
  };
  return NextResponse.json(payload);
}
