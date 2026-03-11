export const dynamic = "force-dynamic";

import { db } from "@/lib/db";
import { giftCards } from "@/lib/db/schema";
import { desc } from "drizzle-orm";
import { getLocale } from "@/lib/i18n/get-locale";
import { getDictionary } from "@/lib/i18n/dictionaries";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import { AdminGiftCardActions } from "./actions";

export default async function AdminGiftCardsPage() {
  const locale = await getLocale();
  const d = getDictionary(locale);

  const cards = await db
    .select()
    .from(giftCards)
    .orderBy(desc(giftCards.createdAt));

  return (
    <div className="p-8">
      <h1 className="text-2xl font-bold text-gray-900">{d["admin.giftCards.title"]}</h1>
      <p className="text-gray-500 mt-1">{d["admin.giftCards.subtitle"]}</p>

      <div className="mt-8 bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-gray-200 bg-gray-50">
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.code"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.theme"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.amount"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.balance"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.status"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.buyer"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.recipient"]}</th>
              <th className="text-left px-4 py-3 font-medium text-gray-500">{d["admin.giftCards.table.date"]}</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {cards.length === 0 ? (
              <tr>
                <td colSpan={9} className="px-4 py-8 text-center text-gray-400">
                  {d["admin.giftCards.empty"]}
                </td>
              </tr>
            ) : (
              cards.map((card) => (
                <tr key={card.id} className="border-b border-gray-100 hover:bg-gray-50">
                  <td className="px-4 py-3 font-mono text-xs">{card.code}</td>
                  <td className="px-4 py-3">
                    {d[`giftCard.theme.${card.theme}` as keyof typeof d] || card.theme}
                  </td>
                  <td className="px-4 py-3 font-mono">{formatCurrency(card.amountKurus, locale)}</td>
                  <td className="px-4 py-3 font-mono">{formatCurrency(card.balanceKurus, locale)}</td>
                  <td className="px-4 py-3">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      card.status === "active" ? "bg-green-100 text-green-700" :
                      card.status === "pending_payment" ? "bg-yellow-100 text-yellow-700" :
                      card.status === "fully_used" ? "bg-gray-100 text-gray-600" :
                      "bg-blue-100 text-blue-700"
                    }`}>
                      {d[`giftCard.status.${card.status}` as keyof typeof d] || card.status}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-xs">{card.buyerName}<br /><span className="text-gray-400">{card.buyerEmail}</span></td>
                  <td className="px-4 py-3 text-xs">{card.recipientName || "—"}<br /><span className="text-gray-400">{card.recipientEmail || ""}</span></td>
                  <td className="px-4 py-3 text-xs text-gray-500">{formatDate(card.createdAt, locale)}</td>
                  <td className="px-4 py-3">
                    {card.status === "pending_payment" && (
                      <AdminGiftCardActions cardId={card.id} />
                    )}
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
