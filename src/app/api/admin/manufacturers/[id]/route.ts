import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { manufacturers } from "@/lib/db/schema";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";
import { notifyManufacturer } from "@/lib/services/manufacturer-notifications";
// Ödeme etkisi hesabı bir SERVİSTE durur: aynı bayrağı partnerin kendisi de
// çevirebiliyor (/api/manufacturer/auth/profile) ve iki taraf aynı rakamı
// söylemek zorunda. Hesap bu rota modülünde dururken partner ucu buradan import
// ediyordu, yani partnerin isteği admin kimlik doğrulama yığınını da yüklüyordu.
import {
  impactSentence,
  paintingImpact,
  type PaintingImpact,
} from "@/lib/services/painting-impact";

/**
 * Admin, üreticinin ATAMA GİRDİLERİNİ düzeltir.
 *
 * Neden gerekli: otomatik atama (Faz 1) yalnızca partnerin kendi girdiği
 * veriye güveniyor. Kapasite, "sipariş alıyor" bayrağı, malzeme etiketleri ve
 * "kendi boyar" seçeneği ranker'ın hem SERT FİLTRESİNİ hem skorunu belirliyor;
 * hiç malzeme beyan etmemiş bir atölye ise her malzemeyi basabilir sayılıyor
 * (lib/services/capability.ts). Bugüne kadar bu alanları yalnız partner
 * değiştirebiliyordu (/api/manufacturer/auth/profile), yani telefonda
 * "kapasitem 2" diyen bir atölyeyi düzeltmenin yolu yoktu.
 *
 * DİKKAT — "kendi boyar" bir ranker girdisi DEĞİL, bir PARA girdisidir:
 * kargo ucu (`/api/manufacturer/orders/[id]/ship`) ve para kartı bayrağı CANLI
 * okur (`services/earning-base.ts` → `manufacturerBaseKurus`), yani bayrağı
 * çevirmek atölyenin ELİNDEKİ boyalı siparişlerde hakediş tabanını değiştirir.
 * Bu yüzden değişiklik önce etkilenen siparişleri sayar, admin'in ayrı onayını
 * (`paintsInHouseAck`) ister ve etkiyi hem denetim satırına hem partner
 * bildirimine LİRA olarak yazar.
 *
 * Malzemeler yalnız admin GERÇEKTEN düzenlediyse gönderilir (istemci alanı
 * dokunulmadıysa hiç yollamaz): hiç `material_*` etiketi olmayan eski bir
 * atölye bugün HER malzemeye aday sayılır (services/capability.ts) ve
 * kapasiteyi düzeltmek için açılan bir formun onu sessizce daraltması olmaz.
 *
 * Bu rota partnerin PROFİLİNİ açmaz: yalnız ranker girdileri. İletişim, adres,
 * banka gibi alanlar Faz 7'ye ait.
 *
 * Her değişiklik iz bırakır: `notes` kolonuna kim/ne zaman/ne + gerekçe satırı
 * EKLENİR (admin_actions satırları bir sipariş istiyor, partner düzeyindeki
 * kararların başka evi yok) ve partnere bildirim + e-posta gider.
 */

const REASON_REQUIRED = "Neden değiştirdiğinizi kısaca yazın (en az 3 karakter).";
const LIMIT_RANGE = "Eş zamanlı iş limiti 1 ile 999 arasında olmalı.";

// Partnerin kendi formu 50 ile sınırlı; admin tavanı 999. Toplu sipariş ya da
// atölye partisi alan bir atölyede gerçek limit 50'yi aşabiliyor ve admin'in
// düzeltmesi gereken tam da bu uç durumlar.
const patchSchema = z
  .object({
    maxConcurrentOrders: z
      .number({ error: LIMIT_RANGE })
      .int({ error: LIMIT_RANGE })
      .min(1, { error: LIMIT_RANGE })
      .max(999, { error: LIMIT_RANGE })
      .optional(),
    acceptingOrders: z.boolean({ error: "Geçersiz sipariş kabul değeri." }).optional(),
    materials: z
      .array(z.enum(["resin", "filament"], { error: "Bilinmeyen malzeme." }))
      .min(1, { error: "En az bir malzeme seçili olmalı." })
      .optional(),
    paintsInHouse: z.boolean({ error: "Geçersiz kendi boyama değeri." }).optional(),
    // "Kendi boyama" değişikliğinin devam eden boyalı siparişlerdeki ödeme
    // etkisini admin ekranda gördü ve onayladı. Etkilenen sipariş varken bu
    // onay olmadan kayıt YAPILMAZ (409 + etki dökümü döner).
    paintsInHouseAck: z.boolean({ error: "Geçersiz onay değeri." }).optional(),
    reason: z
      .string({ error: REASON_REQUIRED })
      .trim()
      .min(3, { error: REASON_REQUIRED })
      .max(500, { error: "Gerekçe en fazla 500 karakter olabilir." }),
  })
  .refine(
    (b) =>
      b.maxConcurrentOrders !== undefined ||
      b.acceptingOrders !== undefined ||
      b.materials !== undefined ||
      b.paintsInHouse !== undefined,
    { message: "Değiştirilecek en az bir alan gönderin." }
  );

// Aynı şekil kontrolü payout ve tax-review rotalarında da var: bozuk bir id
// hiçbir üreticiyi göstermez; kontrol edilmezse Postgres'e geçersiz uuid olarak
// gidip 500 olarak geri döner.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const MATERIAL_LABELS: Record<string, string> = {
  resin: "Reçine (SLA/DLP)",
  filament: "Filament (FDM)",
};

const materialText = (keys: string[]) =>
  keys.length > 0 ? keys.map((k) => MATERIAL_LABELS[k] ?? k).join(", ") : "beyan edilmemiş";

const tl = (kurus: number) =>
  `₺${(kurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/**
 * Formun "kendi boyar" kutusunu çevirmeden önce sorduğu soru: bu değişiklik
 * hangi siparişleri, ne kadar etkiler. Salt okunur.
 */
export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Üretici bulunamadı" }, { status: 404 });
  }

  const current = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, id),
    columns: { id: true, paintsInHouse: true },
  });
  if (!current) {
    return NextResponse.json({ error: "Üretici bulunamadı" }, { status: 404 });
  }

  // Tek anlamlı soru bayrağın TERSİ: form yalnız değeri çevirdiğinde sorar.
  const impact = await paintingImpact(id, current.paintsInHouse, !current.paintsInHouse);
  return NextResponse.json({
    id: current.id,
    paintsInHouse: current.paintsInHouse,
    impact,
    summary: impactSentence(impact),
  });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Üretici bulunamadı" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const current = await db.query.manufacturers.findFirst({
    where: eq(manufacturers.id, id),
    columns: {
      id: true,
      status: true,
      maxConcurrentOrders: true,
      acceptingOrders: true,
      paintsInHouse: true,
      capabilities: true,
      notes: true,
    },
  });
  if (!current) {
    return NextResponse.json({ error: "Üretici bulunamadı" }, { status: 404 });
  }

  const patch: Partial<typeof manufacturers.$inferInsert> = {};
  const changes: string[] = [];

  if (
    body.maxConcurrentOrders !== undefined &&
    body.maxConcurrentOrders !== current.maxConcurrentOrders
  ) {
    patch.maxConcurrentOrders = body.maxConcurrentOrders;
    changes.push(
      `Eş zamanlı iş limiti: ${current.maxConcurrentOrders} → ${body.maxConcurrentOrders}`
    );
  }

  if (body.acceptingOrders !== undefined && body.acceptingOrders !== current.acceptingOrders) {
    patch.acceptingOrders = body.acceptingOrders;
    changes.push(
      `Sipariş alıyor: ${current.acceptingOrders ? "Evet" : "Hayır"} → ${body.acceptingOrders ? "Evet" : "Hayır"}`
    );
  }

  // PARA: bayrağı çevirmek elde duran boyalı siparişlerde üreticinin hakediş
  // tabanını değiştirir (kargo ucu bayrağı canlı okur). Onaysız değiştirilemez.
  let paintingChange: PaintingImpact | null = null;
  if (body.paintsInHouse !== undefined && body.paintsInHouse !== current.paintsInHouse) {
    const impact = await paintingImpact(id, current.paintsInHouse, body.paintsInHouse);
    if (impact.count > 0 && body.paintsInHouseAck !== true) {
      return NextResponse.json(
        {
          error: `Bu değişiklik ${impactSentence(impact)}. Kaydetmek için etkiyi onaylayın.`,
          needsPaintingAck: true,
          impact,
        },
        { status: 409 }
      );
    }
    paintingChange = impact;
    patch.paintsInHouse = body.paintsInHouse;
    changes.push(
      `Kendi boyama: ${current.paintsInHouse ? "Evet" : "Hayır"} → ${body.paintsInHouse ? "Evet" : "Hayır"} (${impactSentence(impact)})`
    );
  }

  // capabilities kolonu yalnız malzeme etiketi tutmuyor: large_format,
  // style_<style> gibi yönlendirme etiketleri de aynı dizide. Diziyi komple
  // yazmak onları siliyordu (partner profilinde düzeltilen hata); burada da
  // SADECE material_* etiketleri değiştirilir, gerisi olduğu gibi kalır.
  const currentTags = Array.isArray(current.capabilities)
    ? current.capabilities.filter((t): t is string => typeof t === "string")
    : [];
  // `materials` GÖNDERİLMEDİYSE malzemelere dokunulmaz. İstemci alanı yalnız
  // admin gerçekten düzenlediğinde yollar; yoksa hiç etiketi olmayan (= her
  // malzemeye aday) eski bir atölye, kapasite düzeltmesi sırasında sessizce
  // daralırdı.
  if (body.materials !== undefined) {
    const currentMaterials = currentTags
      .filter((t) => t.startsWith("material_"))
      .map((t) => t.slice("material_".length))
      .sort();
    const nextMaterials = [...new Set(body.materials)].sort();
    if (currentMaterials.join(",") !== nextMaterials.join(",")) {
      patch.capabilities = [
        ...nextMaterials.map((m) => `material_${m}`),
        ...currentTags.filter((t) => !t.startsWith("material_")),
      ];
      changes.push(
        `Malzemeler: ${materialText(currentMaterials)} → ${materialText(nextMaterials)}`
      );
    }
  }

  // Hiçbir alan gerçekten değişmediyse ne iz satırı yazılır ne partner rahatsız
  // edilir: "kaydet"e boşuna basmak bildirim üretmemeli.
  if (changes.length === 0) {
    return NextResponse.json({
      success: true,
      changed: [],
      message: "Değişen alan yok; kayıt aynı kaldı.",
      manufacturer: {
        id: current.id,
        maxConcurrentOrders: current.maxConcurrentOrders,
        acceptingOrders: current.acceptingOrders,
        paintsInHouse: current.paintsInHouse,
        capabilities: currentTags,
        notes: current.notes,
      },
    });
  }

  const line = formatAdminNoteLine(
    `Atama girdileri güncellendi (${a.session.user.email}): ${changes.join("; ")} — Gerekçe: ${body.reason}`
  );

  const [updated] = await db
    .update(manufacturers)
    .set({
      ...patch,
      // SQL tarafında birleştirme: iki admin aynı anda kaydederse birinin
      // notu diğerinin üzerine yazılmasın (tax-review rotasıyla aynı kural).
      notes: sql`CASE WHEN ${manufacturers.notes} IS NULL OR ${manufacturers.notes} = '' THEN ${line} ELSE ${manufacturers.notes} || E'\n' || ${line} END`,
      updatedAt: new Date(),
    })
    .where(eq(manufacturers.id, id))
    .returning({
      id: manufacturers.id,
      maxConcurrentOrders: manufacturers.maxConcurrentOrders,
      acceptingOrders: manufacturers.acceptingOrders,
      paintsInHouse: manufacturers.paintsInHouse,
      capabilities: manufacturers.capabilities,
      notes: manufacturers.notes,
    });

  if (!updated) {
    return NextResponse.json({ error: "Üretici bulunamadı" }, { status: 404 });
  }

  // Partner haberdar edilmeli: bu alanlar ona gelen iş sayısını belirliyor.
  // Reddedilmiş başvuruya bildirim gitmez — o hesap kapalı, e-posta yalnızca
  // gürültü olurdu. Bildirim hatası kaydı geri almaz (yazma zaten bitti).
  if (current.status !== "rejected") {
    await notifyManufacturer({
      manufacturerId: id,
      type: "admin_message",
      subject: "Sipariş ayarlarınız güncellendi",
      body:
        `Yöneticimiz üretim ayarlarınızı güncelledi:\n\n` +
        changes.map((c) => `• ${c}`).join("\n") +
        `\n\nGerekçe: ${body.reason}\n\n` +
        // Para etkisi ayrı ve açık bir cümle olarak yazılır: add-painting
        // bildiriminde olduğu gibi, partner payının neden değiştiğini lira
        // cinsinden görmeli.
        (paintingChange && paintingChange.count > 0
          ? `Ödeme etkisi: elinizdeki ${paintingChange.count} boyalı siparişte hakediş tabanınız toplam ${tl(Math.abs(paintingChange.totalDeltaKurus))} ${paintingChange.totalDeltaKurus < 0 ? "azalacak" : "artacak"} (${paintingChange.orders.map((o) => o.orderNumber).slice(0, 5).join(", ")}${paintingChange.truncated || paintingChange.orders.length > 5 ? " ve diğerleri" : ""}). Kargolanmış ya da hakedişi yazılmış siparişler etkilenmez.\n\n`
          : "") +
        `Bu ayarlar size yönlendirilen iş sayısını doğrudan etkiler. Yanlış olduğunu düşünüyorsanız panelinizden düzeltebilir ya da bize yazabilirsiniz.`,
    }).catch((e) => console.error("notifyManufacturer (ranker inputs) failed", e));
  }

  return NextResponse.json({
    success: true,
    changed: changes,
    manufacturer: {
      ...updated,
      capabilities: Array.isArray(updated.capabilities) ? updated.capabilities : [],
    },
  });
}
