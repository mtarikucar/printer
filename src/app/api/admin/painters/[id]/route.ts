import { NextRequest, NextResponse } from "next/server";
import { eq, sql } from "drizzle-orm";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth/require-admin";
import { db } from "@/lib/db";
import { painters } from "@/lib/db/schema";
import { formatAdminNoteLine } from "@/lib/config/order-status-policy";
import { notifyPainter } from "@/lib/services/painter-notifications";

/**
 * Admin, boyacının ATAMA GİRDİLERİNİ düzeltir. Üretici karşılığıyla aynı
 * sözleşme: /api/admin/manufacturers/[id].
 *
 * Boyacı sıralaması Faz 4'te geliyor ve girdileri bugünden doğru olmalı:
 * kapasite (aktif iş sayısı limiti) ve "iş alıyor" bayrağı uygunluk filtresini,
 * teknik etiketleri ise hangi işin kime gideceğini belirleyecek. Bugün bu
 * alanları yalnız boyacı değiştirebiliyor (/api/painter/auth/profile), yani
 * telefonda "bu hafta iş alamam" diyen bir atölyeyi sistemden çıkarmanın yolu
 * yok.
 *
 * Boyacıda kapsama (etki alanı) kolonu YOKTUR ve bu rota onu icat etmez;
 * adres/iletişim gibi profil alanları da Faz 7'ye aittir.
 *
 * Değişiklik `notes` kolonuna EKLENİR (painter_actions satırları bir sipariş
 * istiyor) ve boyacıya bildirim + e-posta gider.
 */

const REASON_REQUIRED = "Neden değiştirdiğinizi kısaca yazın (en az 3 karakter).";
const LIMIT_RANGE = "Eş zamanlı iş limiti 1 ile 999 arasında olmalı.";

const patchSchema = z
  .object({
    // Partnerin kendi formu 50 ile sınırlı; admin tavanı 999 (toplu işlerde
    // gerçek limit 50'yi aşabiliyor ve düzeltmesi gereken admin).
    maxConcurrentOrders: z
      .number({ error: LIMIT_RANGE })
      .int({ error: LIMIT_RANGE })
      .min(1, { error: LIMIT_RANGE })
      .max(999, { error: LIMIT_RANGE })
      .optional(),
    acceptingOrders: z.boolean({ error: "Geçersiz iş kabul değeri." }).optional(),
    // Teknikler serbest metin etiket olarak saklanıyor (kayıt formu da öyle
    // gönderiyor). Bilinen 5 anahtarla sınırlamak, eski kayıtlardaki farklı
    // etiketleri admin kaydettiğinde sessizce silerdi.
    capabilities: z
      .array(
        z
          .string({ error: "Geçersiz teknik." })
          .trim()
          .min(1, { error: "Boş teknik gönderilemez." })
          .max(40, { error: "Teknik adı en fazla 40 karakter olabilir." })
      )
      .min(1, { error: "En az bir teknik seçili olmalı." })
      .max(12, { error: "En fazla 12 teknik seçilebilir." })
      .optional(),
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
      b.capabilities !== undefined,
    { message: "Değiştirilecek en az bir alan gönderin." }
  );

// Bozuk bir id hiçbir boyacıyı göstermez; kontrol edilmezse Postgres'e geçersiz
// uuid olarak gider ve 500 döner.
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// Kayıt formundaki teknik anahtarları — yalnız not/bildirim metnini okunur
// yapmak için. Listede olmayan bir etiket ham hâliyle yazılır.
const TECHNIQUE_LABELS: Record<string, string> = {
  hand: "El fırçası",
  airbrush: "Havalı fırça (Airbrush)",
  detail: "İnce detay",
  priming: "Astarlama",
  sealing: "Vernik / Koruma",
};

const techniqueText = (keys: string[]) =>
  keys.length > 0 ? keys.map((k) => TECHNIQUE_LABELS[k] ?? k).join(", ") : "beyan edilmemiş";

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const a = await requireAdmin();
  if ("response" in a) return a.response;

  const { id } = await params;
  if (!UUID_RE.test(id)) {
    return NextResponse.json({ error: "Boyacı bulunamadı" }, { status: 404 });
  }

  const parsed = patchSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }
  const body = parsed.data;

  const current = await db.query.painters.findFirst({
    where: eq(painters.id, id),
    columns: {
      id: true,
      status: true,
      maxConcurrentOrders: true,
      acceptingOrders: true,
      capabilities: true,
      notes: true,
    },
  });
  if (!current) {
    return NextResponse.json({ error: "Boyacı bulunamadı" }, { status: 404 });
  }

  const patch: Partial<typeof painters.$inferInsert> = {};
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
      `İş alıyor: ${current.acceptingOrders ? "Evet" : "Hayır"} → ${body.acceptingOrders ? "Evet" : "Hayır"}`
    );
  }

  const currentTags = Array.isArray(current.capabilities)
    ? current.capabilities.filter((t): t is string => typeof t === "string")
    : [];
  if (body.capabilities !== undefined) {
    // Boyacıda capabilities SADECE teknik etiketi tutuyor (üreticinin aksine
    // yönlendirme etiketi yok), bu yüzden gelen küme diziyi tamamen değiştirir.
    const nextTags = [...new Set(body.capabilities)];
    if ([...currentTags].sort().join(",") !== [...nextTags].sort().join(",")) {
      patch.capabilities = nextTags;
      changes.push(`Teknikler: ${techniqueText(currentTags)} → ${techniqueText(nextTags)}`);
    }
  }

  // Hiçbir alan gerçekten değişmediyse iz satırı da bildirim de yazılmaz.
  if (changes.length === 0) {
    return NextResponse.json({
      success: true,
      changed: [],
      message: "Değişen alan yok; kayıt aynı kaldı.",
      painter: {
        id: current.id,
        maxConcurrentOrders: current.maxConcurrentOrders,
        acceptingOrders: current.acceptingOrders,
        capabilities: currentTags,
        notes: current.notes,
      },
    });
  }

  const line = formatAdminNoteLine(
    `Atama girdileri güncellendi (${a.session.user.email}): ${changes.join("; ")} — Gerekçe: ${body.reason}`
  );

  const [updated] = await db
    .update(painters)
    .set({
      ...patch,
      // Birleştirme SQL tarafında: iki admin aynı anda kaydederse biri
      // diğerinin notunu ezmesin (tax-review rotasıyla aynı kural).
      notes: sql`CASE WHEN ${painters.notes} IS NULL OR ${painters.notes} = '' THEN ${line} ELSE ${painters.notes} || E'\n' || ${line} END`,
      updatedAt: new Date(),
    })
    .where(eq(painters.id, id))
    .returning({
      id: painters.id,
      maxConcurrentOrders: painters.maxConcurrentOrders,
      acceptingOrders: painters.acceptingOrders,
      capabilities: painters.capabilities,
      notes: painters.notes,
    });

  if (!updated) {
    return NextResponse.json({ error: "Boyacı bulunamadı" }, { status: 404 });
  }

  // Reddedilmiş başvuruya bildirim gitmez — hesap kapalı, e-posta gürültü olur.
  // Bildirim hatası yazmayı geri almaz (kayıt zaten tamamlandı).
  if (current.status !== "rejected") {
    await notifyPainter({
      painterId: id,
      type: "admin_message",
      subject: "Boyama ayarlarınız güncellendi",
      body:
        `Yöneticimiz boyama ayarlarınızı güncelledi:\n\n` +
        changes.map((c) => `• ${c}`).join("\n") +
        `\n\nGerekçe: ${body.reason}\n\n` +
        `Bu ayarlar size yönlendirilen iş sayısını doğrudan etkiler. Yanlış olduğunu düşünüyorsanız panelinizden düzeltebilir ya da bize yazabilirsiniz.`,
    }).catch((e) => console.error("notifyPainter (ranker inputs) failed", e));
  }

  return NextResponse.json({
    success: true,
    changed: changes,
    painter: {
      ...updated,
      capabilities: Array.isArray(updated.capabilities) ? updated.capabilities : [],
    },
  });
}
