export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { giftCards, giftCardRedemptions } from "@/lib/db/schema";
import { desc, eq, count } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { CreateGiftCardForm } from "./create-form";
import { AdminGiftCardActions } from "./actions";

export default async function AdminGiftCardsPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const cards = await db
    .select({
      id: giftCards.id,
      code: giftCards.code,
      theme: giftCards.theme,
      amountKurus: giftCards.amountKurus,
      balanceKurus: giftCards.balanceKurus,
      status: giftCards.status,
      note: giftCards.note,
      maxRedemptions: giftCards.maxRedemptions,
      recipientName: giftCards.recipientName,
      recipientEmail: giftCards.recipientEmail,
      expiresAt: giftCards.expiresAt,
      createdAt: giftCards.createdAt,
      redemptionCount: count(giftCardRedemptions.id),
    })
    .from(giftCards)
    .leftJoin(giftCardRedemptions, eq(giftCards.id, giftCardRedemptions.giftCardId))
    .groupBy(giftCards.id)
    .orderBy(desc(giftCards.createdAt));

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">{d["admin.giftCards.title"]}</h1>
      <p className="text-gray-500 mt-1">{d["admin.giftCards.subtitle"]}</p>

      <div className="mt-6">
        <CreateGiftCardForm d={d} />
      </div>

      <div className="mt-8 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.code"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.amount"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.balance"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.status"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.expires"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.limit"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.note"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.recipient"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.date"]}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 ? (
              <tr>
                <td colSpan={10} className="px-4 py-8 text-center text-gray-400">
                  {d["admin.giftCards.empty"]}
                </td>
              </tr>
            ) : (
              cards.map((card) => (
                <tr key={card.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{card.code}</td>
                  <td className="px-4 py-3 font-mono">{formatCurrency(card.amountKurus, locale)}</td>
                  <td className="px-4 py-3 font-mono">{formatCurrency(card.balanceKurus, locale)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      card.status === "active" ? "bg-green-100 text-green-700" :
                      card.status === "pending_payment" ? "bg-yellow-100 text-yellow-700" :
                      card.status === "fully_used" ? "bg-gray-100 text-gray-600" :
                      card.status === "expired" ? "bg-red-100 text-red-700" :
                      "bg-blue-100 text-blue-700"
                    }`}>
                      {d[`giftCard.status.${card.status}` as keyof typeof d] || card.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(card.expiresAt, locale)}</td>
                  <td className="px-4 py-3 text-xs text-gray-500">
                    {card.maxRedemptions !== null
                      ? `${card.redemptionCount}/${card.maxRedemptions}`
                      : d["admin.giftCards.unlimited"]}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{card.note || "—"}</td>
                  <td className="px-4 py-3 text-xs">{card.recipientName || "—"}<br /><span className="text-gray-400">{card.recipientEmail || ""}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(card.createdAt, locale)}</td>
                  <td className="px-4 py-3">
                    <AdminGiftCardActions cardId={card.id} code={card.code} status={card.status} d={d} />
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
