import { NextRequest, NextResponse } from "next/server";
import { rateLimitAsync, extractClientIp } from "@/lib/services/rate-limit";
import { joinSessionSchema } from "@/lib/validators/workshop";
import { joinSession } from "@/lib/services/workshop-participant";

/**
 * Public atölye katılımı: `/atolye/katil/<token>` formunun gönderim ucu.
 *
 * Kimlik doğrulaması yoktur — token linkin kendisidir. Koltuk rezervasyonu,
 * taslak ve katılımcı kaydı servistedir (workshop-participant.ts); burada
 * yalnızca sınırlama, doğrulama ve HTTP eşlemesi yapılır.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  const { token } = await params;

  // Public uç: hem IP hem token başına sınır. Foto yükleme + taslak yaratma
  // pahalı işler; workshop-requests route'undaki aynı desen.
  const ip = extractClientIp(request);
  const ipRl = await rateLimitAsync(`workshop-join:${ip}`, 5, 60 * 60 * 1000);
  if (!ipRl.success) {
    return NextResponse.json(
      { error: "Çok fazla deneme yaptınız. Lütfen bir saat sonra tekrar deneyin." },
      { status: 429 }
    );
  }

  // Token uzunluğu sınırı, sayaç anahtarı yazılmadan ÖNCE: aksi hâlde uydurma
  // ve sınırsız uzunlukta bir token Redis'te sınırsız büyüklükte bir anahtar
  // açardı. Yanlış ve uydurma token ayırt edilemez (aynı 404).
  if (!token || token.length > 64) {
    return NextResponse.json({ error: "Seans bulunamadı" }, { status: 404 });
  }
  const tokenRl = await rateLimitAsync(`workshop-join-token:${token}`, 60, 60 * 60 * 1000);
  if (!tokenRl.success) {
    return NextResponse.json(
      { error: "Bu seans için çok fazla istek alındı. Lütfen sonra tekrar deneyin." },
      { status: 429 }
    );
  }

  const parsed = joinSessionSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? "Geçersiz istek" },
      { status: 400 }
    );
  }

  try {
    const result = await joinSession(token, {
      fullName: parsed.data.fullName,
      email: parsed.data.email,
      phone: parsed.data.phone,
      photoKey: parsed.data.photoKey,
    });
    if ("error" in result) {
      return NextResponse.json({ error: result.error }, { status: result.status });
    }
    return NextResponse.json(result);
  } catch (err) {
    // Koltuk servisin catch bloğunda zaten geri bırakıldı; burada müşteriye
    // HTML hata sayfası değil, okunabilir bir JSON dönmek kalıyor.
    console.error("workshop join failed", err);
    return NextResponse.json(
      { error: "Katılım kaydedilemedi. Lütfen tekrar deneyin." },
      { status: 500 }
    );
  }
}
