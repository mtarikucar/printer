export const dynamic = "force-dynamic";

import Link from "next/link";
import { sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { waConversations, waMessages } from "@/lib/db/schema";
import { listConversations } from "@/lib/services/whatsapp-conversation";
import {
  MODE_BADGE,
  MODE_LABEL,
  formatRelative,
  previewText,
} from "./shared";

const LIST_LIMIT = 100;

interface LastMessageRow {
  conversation_id: string;
  body: string | null;
  type: string;
  direction: "in" | "out";
}

interface UnansweredRow {
  conversation_id: string;
  c: number;
}

export default async function AdminWhatsAppPage() {
  const conversations = await listConversations(LIST_LIMIT);

  // `listConversations` orders by last_inbound_at DESC, and Postgres sorts
  // NULLs FIRST on DESC — a thread we opened but that never got a reply would
  // otherwise sit above live ones. Re-rank on the value we actually mean.
  const sorted = [...conversations].sort(
    (a, b) =>
      (b.lastInboundAt ?? b.createdAt).getTime() -
      (a.lastInboundAt ?? a.createdAt).getTime()
  );

  const ids = sorted.map((c) => c.id);

  // Last message per thread + how many inbound messages arrived after our last
  // outbound one. The second number is the closest honest thing to "unread":
  // nobody marks a WhatsApp thread read here, but "customer wrote N times and
  // we have not answered since" is the queue an admin actually works.
  const [lastRows, unansweredRows] = ids.length
    ? await Promise.all([
        db.execute(sql`
          SELECT DISTINCT ON (${waMessages.conversationId})
                 ${waMessages.conversationId} AS conversation_id,
                 ${waMessages.body} AS body,
                 ${waMessages.type} AS type,
                 ${waMessages.direction} AS direction
          FROM ${waMessages}
          WHERE ${waMessages.conversationId} IN ${ids}
          ORDER BY ${waMessages.conversationId}, ${waMessages.createdAt} DESC`),
        db.execute(sql`
          SELECT ${waMessages.conversationId} AS conversation_id, count(*)::int AS c
          FROM ${waMessages}
          JOIN ${waConversations}
            ON ${waConversations.id} = ${waMessages.conversationId}
          WHERE ${waMessages.conversationId} IN ${ids}
            AND ${waMessages.direction} = 'in'
            AND (${waConversations.lastOutboundAt} IS NULL
                 OR ${waMessages.createdAt} > ${waConversations.lastOutboundAt})
          GROUP BY 1`),
      ])
    : [{ rows: [] }, { rows: [] }];

  const lastByConversation = new Map<string, LastMessageRow>(
    (lastRows.rows as LastMessageRow[]).map((r) => [r.conversation_id, r])
  );
  const unansweredByConversation = new Map<string, number>(
    (unansweredRows.rows as UnansweredRow[]).map((r) => [
      r.conversation_id,
      Number(r.c),
    ])
  );

  const now = Date.now();
  const openWindows = sorted.filter(
    (c) => (c.windowExpiresAt?.getTime() ?? 0) > now
  ).length;

  return (
    <div className="p-4 sm:p-8">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">WhatsApp</h1>
        <p className="text-sm text-gray-500 mt-1">
          {sorted.length} konuşma · {openWindows} tanesinde 24 saatlik hizmet
          penceresi açık. Pencere kapalıyken serbest metin Meta tarafından
          reddedilir (hata 131047); yalnızca onaylı şablon gider.
        </p>
      </div>

      {sorted.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-200 p-8 text-center text-gray-500">
          Henüz WhatsApp konuşması yok.
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <div className="overflow-x-auto">
            <table className="min-w-full text-sm">
              <thead className="bg-gray-50 text-left text-xs uppercase tracking-wider text-gray-500">
                <tr>
                  <th className="px-4 py-3 font-semibold">Kişi</th>
                  <th className="px-4 py-3 font-semibold">Mod</th>
                  <th className="px-4 py-3 font-semibold">Son mesaj</th>
                  <th className="px-4 py-3 font-semibold">Pencere</th>
                  <th className="px-4 py-3 font-semibold">Son gelen</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100">
                {sorted.map((c) => {
                  const last = lastByConversation.get(c.id);
                  const unanswered = unansweredByConversation.get(c.id) ?? 0;
                  const windowOpen =
                    (c.windowExpiresAt?.getTime() ?? 0) > now;
                  return (
                    <tr key={c.id} className="hover:bg-gray-50">
                      <td className="px-4 py-3 align-top">
                        <Link
                          href={`/admin/whatsapp/${c.id}`}
                          className="font-medium text-gray-900 hover:text-green-700"
                        >
                          {c.profileName || "İsimsiz"}
                        </Link>
                        <div className="font-mono text-xs text-gray-500">
                          {c.phoneE164}
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        <span
                          className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${MODE_BADGE[c.mode]}`}
                        >
                          {MODE_LABEL[c.mode]}
                        </span>
                      </td>
                      <td className="px-4 py-3 align-top max-w-md">
                        <div className="flex items-start gap-2">
                          {unanswered > 0 && (
                            <span className="mt-0.5 shrink-0 bg-amber-500 text-white text-xs font-bold px-2 py-0.5 rounded-full">
                              {unanswered}
                            </span>
                          )}
                          <span
                            className={`truncate block ${
                              last?.direction === "in"
                                ? "text-gray-900"
                                : "text-gray-500"
                            }`}
                          >
                            {last
                              ? `${last.direction === "in" ? "" : "↩ "}${previewText(last.body, last.type)}`
                              : "—"}
                          </span>
                        </div>
                      </td>
                      <td className="px-4 py-3 align-top">
                        {windowOpen ? (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">
                            Açık · {formatRelative(c.windowExpiresAt!, now, true)}
                          </span>
                        ) : (
                          <span className="inline-block px-2 py-0.5 rounded-full text-xs font-medium bg-gray-200 text-gray-600">
                            Kapalı · şablon
                          </span>
                        )}
                      </td>
                      <td className="px-4 py-3 align-top text-xs text-gray-500 whitespace-nowrap">
                        {c.lastInboundAt
                          ? formatRelative(c.lastInboundAt, now)
                          : "—"}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
