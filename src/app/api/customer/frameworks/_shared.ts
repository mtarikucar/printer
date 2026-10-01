/**
 * `/api/customer/frameworks/**` uçlarının ortak kabuğu.
 *
 * Bu dosya bir ROTA DEĞİLDİR (App Router yalnız `route.ts` adını rota sayar);
 * iki ucun paylaştığı tek şey burada durur, böylece "yok" cevabı iki yerde iki
 * farklı cümle olmaz.
 */
import { NextResponse } from "next/server";

export const FRAMEWORK_NOT_FOUND = "Çerçeve anlaşma bulunamadı.";

/**
 * Erişimi olmayan izleyiciye "yok" denir.
 *
 * "Var ama senin değil" DE BİR BİLGİDİR: numaralar sıradan (`C-000123`) ve
 * tahmin edilebilir, yani 403 ile 404'ü ayırmak bir numaranın var olup
 * olmadığını sayan bir uca dönüşürdü. Bayrak kapalıyken de AYNI cevap verilir
 * (403 değil): kapalı bir özelliğin varlığını duyurmanın anlamı yok.
 */
export function frameworkNotFound(): NextResponse {
  return NextResponse.json(
    { error: FRAMEWORK_NOT_FOUND, code: "framework_not_found" },
    { status: 404 }
  );
}
