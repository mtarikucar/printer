export const dynamic = "force-dynamic";

import Link from "next/link";
import QRCode from "qrcode";
import { eq } from "drizzle-orm";
import { db } from "@/lib/db";
import { orders } from "@/lib/db/schema";
import {
  ensureJourneyToken,
  journeyUrl,
  journeyEligibility,
} from "@/lib/services/order-journey";
import { CardActions } from "./card-actions";
import "./card.css";

/**
 * The card that goes in the box. Printed A6, portrait.
 *
 * Rendered server-side with the QR inlined as SVG so it prints at the
 * printer's own resolution rather than a rasterised approximation, and so the
 * page needs no network fetch at print time.
 */
export default async function OrderJourneyCardPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;

  const order = await db.query.orders.findFirst({
    where: eq(orders.id, id),
    columns: {
      id: true,
      orderNumber: true,
      customerName: true,
      previewId: true,
      modelGlbKey: true,
      modelGlbUrl: true,
      journeyToken: true,
    },
  });

  if (!order) {
    return (
      <div className="p-8">
        <p className="text-gray-700">Sipariş bulunamadı.</p>
      </div>
    );
  }

  const { eligible, blockedBy } = await journeyEligibility(order);
  // A token already minted keeps the card printable even if the order would no
  // longer qualify (a purged photo must not invalidate a card in the box).
  if (!eligible && !order.journeyToken) {
    return (
      <div className="p-4 sm:p-8">
        <h1 className="text-2xl font-bold text-gray-900">Yolculuk kartı</h1>
        <div className="mt-4 max-w-xl rounded-xl border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
          <p>
            Bu sipariş için kart üretilemez. Yolculuk sayfası bir{" "}
            <strong>müşteri fotoğrafı</strong> ve{" "}
            <strong>yüklenmiş bir 3D model</strong> ile anlamlı olur.
          </p>
          <p className="mt-2 text-amber-800">
            {blockedBy === "no_photo"
              ? "Bu siparişte müşteri fotoğrafı yok — anlatılacak bir dönüşüm yok."
              : "Modeli yükleyin, kart otomatik olarak hazır olacak."}
          </p>
        </div>
        <Link
          href={`/admin/orders/${id}`}
          className="mt-4 inline-block text-sm text-blue-700 hover:underline"
        >
          ← Siparişe dön
        </Link>
      </div>
    );
  }

  // Minting here means a card can be produced for orders that shipped before
  // this feature existed, without a backfill.
  const token = await ensureJourneyToken(id);
  if (!token) {
    return (
      <div className="p-8">
        <p className="text-gray-700">Bağlantı üretilemedi. Tekrar deneyin.</p>
      </div>
    );
  }

  const url = journeyUrl(token);
  const qrSvg = await QRCode.toString(url, {
    type: "svg",
    errorCorrectionLevel: "H",
    margin: 0,
    color: { dark: "#1E1726", light: "#FFFFFF" },
  });
  const firstName = (order.customerName ?? "").trim().split(/\s+/)[0];

  return (
    <div className="card-page">
      <div className="no-print p-4 sm:p-8">
        <h1 className="text-2xl font-bold text-gray-900">Yolculuk kartı</h1>
        <p className="mt-1 max-w-2xl text-sm text-gray-600">
          A6 boyutunda, kutuya konmak üzere. Yazdırırken kenar boşluklarını
          &quot;yok&quot; ve ölçeği %100 yapın. Karekod{" "}
          <strong>{order.orderNumber}</strong> siparişinin yolculuk sayfasına
          gider.
        </p>
        <CardActions url={url} />
        <Link
          href={`/admin/orders/${id}`}
          className="mt-3 inline-block text-sm text-blue-700 hover:underline"
        >
          ← Siparişe dön
        </Link>
      </div>

      <article className="journey-card">
        <div className="journey-card__inner">
          <p className="journey-card__brand">FIGURUNICA</p>

          <h2 className="journey-card__title">
            {firstName ? `${firstName},` : "Merhaba,"}
            <br />
            bunun bir hikâyesi var.
          </h2>

          <p className="journey-card__body">
            Elindeki figür bir fotoğraftan yola çıktı. Nereden nereye geldiğini
            görmek için karekodu okut.
          </p>

          <div
            className="journey-card__qr"
            aria-label="Yolculuk sayfası karekodu"
            dangerouslySetInnerHTML={{ __html: qrSvg }}
          />

          <p className="journey-card__order">{order.orderNumber}</p>
        </div>
      </article>
    </div>
  );
}
