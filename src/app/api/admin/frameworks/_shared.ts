/**
 * `/api/admin/frameworks/**` uçlarının ortak kabuğu.
 *
 * Bu dosya bir ROTA DEĞİLDİR (`_` ön eki App Router'ın dışında bırakır); sekiz
 * ucun aynı dört kararı (bayrak kapısı, admin oturumu, kimlik ayrıştırma,
 * beklenen ret → cevap) kopyalamaması için var. Kopyalandığında ilk
 * düzeltmede bazı uçlar kapıyı yeniden yorumlar — `/api/quotes/_shared.ts`
 * dosyasının başlığındaki gerekçe birebir geçerli.
 *
 * ─── BAYRAK KAPALIYKEN 404, 403 DEĞİL ──────────────────────────────────────
 *
 * `quoteApiEnabled` deseni (`quote-access.ts`): kapalı bir özelliğin varlığını
 * duyurmanın anlamı yok. Admin oturumu iç test için kapıdan geçer, yani
 * lansman öncesi uçlar sahibi için çalışır.
 *
 * ─── PARA ALANI SESSİZCE YOK SAYILMAZ, REDDEDİLİR ──────────────────────────
 *
 * Gövdede tutar taşıyan bir alan (`amountKurus`, `unitKurus`, `totalKurus`, …)
 * gelirse istek 400 ile düşer. Bu bir hijyen değil, kilidin kendisi: parti
 * tutarı anlaşmanın DONMUŞ anlık görüntüsünden hesaplanır ve gövdeden gelen
 * bir tutarı "yok saymak", bir gün onu okuyan bir yazıcının kapıyı sessizce
 * açmasına zemin hazırlar. Tek istisna `expectedAmountKurus`tur ve o bir
 * GİRDİ değil BEYANDIR (uyuşmazsa 409).
 *
 * ─── BEKLENEN RET `catch`TE DEĞİL, AKIŞTA ÇEVRİLİR ─────────────────────────
 *
 * Depo genelindeki "boş gövdeli 500 imkânsız" taraması
 * (`scripts/test-order-status-policy.ts`) rotanın `catch`inde yalnız
 * `handleRouteFailure` görmek ister.
 */
import { NextResponse, type NextRequest } from "next/server";
import type { z } from "zod";
import { requireAdmin, type AdminSession } from "@/lib/auth/require-admin";
import { frameworkSurfacesEnabled } from "@/lib/services/quote-access";
import { QuoteServiceError } from "@/lib/services/quote-service";
import type { FrameworkPlanRefusal } from "@/lib/config/quote-framework";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Bayrak kapalıyken ve kimlik tanınmadığında AYNI cevap: "yok". */
const FRAMEWORK_NOT_FOUND = "Çerçeve anlaşma bulunamadı.";

export function frameworkNotFound(): NextResponse {
  return NextResponse.json(
    { error: FRAMEWORK_NOT_FOUND, code: "framework_not_found" },
    { status: 404 }
  );
}

/**
 * Gövdede TUTAR taşıyan alanlar — reddedilir (dosya başlığı).
 *
 * `expectedAmountKurus` bilerek DIŞARIDA: o bir beyan ve `releaseBatch`
 * uyuşmazlıkta 409 döner.
 */
const MONEY_FIELD_RE = /kurus$/i;
const DECLARED_AMOUNT_FIELDS = new Set(["expectedAmountKurus"]);

/** Gövdede bir para alanı var mı — iç içe nesnelerde de aranır. */
function bodyMoneyFields(value: unknown, path = ""): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item, index) => bodyMoneyFields(item, `${path}[${index}]`));
  }
  if (typeof value !== "object" || value === null) return [];
  const hits: string[] = [];
  for (const [key, nested] of Object.entries(value as Record<string, unknown>)) {
    const here = path ? `${path}.${key}` : key;
    if (MONEY_FIELD_RE.test(key) && !DECLARED_AMOUNT_FIELDS.has(key)) hits.push(here);
    hits.push(...bodyMoneyFields(nested, here));
  }
  return hits;
}

export interface FrameworkRouteContext {
  session: AdminSession;
  frameworkId: string;
}

/**
 * Bayrak + admin oturumu + `[id]` segmenti.
 *
 * Kimlik uuid değilse servise HİÇ gidilmez: `quote_frameworks.id` bir uuid
 * kolonudur ve `C-000123` gibi bir değer sorguyu `22P02` ile düşürürdü
 * (gövdesiz 500).
 */
export async function frameworkContext(ctx: {
  params: Promise<{ id: string }>;
}): Promise<FrameworkRouteContext | { response: NextResponse }> {
  const gate = await frameworkGate();
  if (gate) return gate;
  const a = await requireAdmin();
  if ("response" in a) return { response: a.response };
  const { id } = await ctx.params;
  const frameworkId = id.trim();
  if (!UUID_RE.test(frameworkId)) return { response: frameworkNotFound() };
  return { session: a.session, frameworkId: frameworkId.toLowerCase() };
}

/** `[batchId]` de uuid olmak zorunda (aynı gerekçe). */
export function batchIdOf(raw: string): string | null {
  const id = raw.trim();
  return UUID_RE.test(id) ? id.toLowerCase() : null;
}

/** Kimliksiz uçlar (liste, oluştur) için yalnız bayrak + oturum. */
export async function frameworkListContext(): Promise<
  { session: AdminSession } | { response: NextResponse }
> {
  const gate = await frameworkGate();
  if (gate) return gate;
  const a = await requireAdmin();
  if ("response" in a) return { response: a.response };
  return { session: a.session };
}

async function frameworkGate(): Promise<{ response: NextResponse } | null> {
  return (await frameworkSurfacesEnabled()) ? null : { response: frameworkNotFound() };
}

/**
 * Gövdeyi okur, PARA alanını reddeder, şemadan geçirir.
 *
 * Bozuk gövde de 400'dür: boş nesne saymak, eksik bir gerekçeyi "gerekçe
 * gönderilmedi" yerine "gövde okunamadı"dan ayırmayı imkânsız kılardı.
 */
export async function frameworkBody<T>(
  request: NextRequest,
  schema: z.ZodType<T>
): Promise<{ body: T } | { response: NextResponse }> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return {
      response: NextResponse.json(
        { error: "İstek gövdesi okunamadı.", code: "invalid_body" },
        { status: 400 }
      ),
    };
  }
  const money = bodyMoneyFields(raw);
  if (money.length > 0) {
    return {
      response: NextResponse.json(
        {
          error:
            `Gövdede tutar alanı var (${money.join(", ")}). Parti tutarı çerçeve ` +
            "anlaşmanın kilitli fiyatından hesaplanır; istekte tutar gönderilemez.",
          code: "money_field_rejected",
        },
        { status: 400 }
      ),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    return {
      response: NextResponse.json(
        {
          error: `İstek gövdesi geçersiz: ${parsed.error.issues
            .map((i) => `${i.path.join(".") || "gövde"} — ${i.message}`)
            .join("; ")}`,
          code: "invalid_body",
        },
        { status: 400 }
      ),
    };
  }
  return { body: parsed.data };
}

/**
 * Servisi çağırır ve BEKLENEN reddini cevaba çevirir; beklenmeyen hata
 * OLDUĞU GİBİ yukarı çıkar.
 *
 * Neden bir sarmalayıcı: çerçeve servisi retlerini `QuoteServiceError`
 * FIRLATARAK bildiriyor (`/api/quotes/**` deseni), yani onları yakalamak
 * zorunludur. Rotanın en dış `catch`i böylece YALNIZ `handleRouteFailure`
 * kalır ve depo genelindeki "boş gövdeli 500 imkânsız" taraması yeşil kalır.
 */
export async function runFrameworkService<T>(
  fn: () => Promise<T>
): Promise<{ value: T } | { response: NextResponse }> {
  try {
    return { value: await fn() };
  } catch (e) {
    const known = serviceRefusal(e);
    if (known) return { response: known };
    throw e;
  }
}

/** Servisin BEKLENEN reddi → cevabı (Türkçe cümle + kod); değilse `null`. */
function serviceRefusal(e: unknown): NextResponse | null {
  if (!(e instanceof QuoteServiceError)) return null;
  return NextResponse.json(
    { error: e.message, ...(e.code ? { code: e.code } : {}) },
    { status: e.status }
  );
}

/**
 * Saf kapının retleri → 409.
 *
 * Retler AYRI AYRI taşınır: kurallar birbirini maskelemez, yoksa admin bir
 * düzeltmeden sonra ikinci duvara toslar (saf çekirdeğin kendi kararı).
 */
export function refusalResponse(refusals: FrameworkPlanRefusal[]): NextResponse {
  return NextResponse.json(
    {
      error: refusals.map((r) => r.message).join(" "),
      code: refusals[0]?.code ?? "framework_refused",
      refusals,
    },
    { status: 409 }
  );
}
