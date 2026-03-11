"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import type { Dictionary } from "@/lib/i18n/dictionaries/en";

export function CreateGiftCardForm({ d }: { d: Dictionary }) {
  const router = useRouter();
  const [amountTL, setAmountTL] = useState("");
  const [recipientName, setRecipientName] = useState("");
  const [recipientEmail, setRecipientEmail] = useState("");
  const [note, setNote] = useState("");
  const [expirationDays, setExpirationDays] = useState("365");
  const [maxRedemptions, setMaxRedemptions] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [createdCode, setCreatedCode] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmitting(true);
    setError(null);

    try {
      const res = await fetch("/api/admin/gift-cards", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          amountTL: Number(amountTL),
          recipientName: recipientName || undefined,
          recipientEmail: recipientEmail || undefined,
          note: note || undefined,
          expirationDays: expirationDays === "0" ? 0 : Number(expirationDays) || undefined,
          maxRedemptions: maxRedemptions ? Number(maxRedemptions) : undefined,
        }),
      });

      if (!res.ok) {
        const data = await res.json().catch(() => null);
        throw new Error(
          Array.isArray(data?.error) ? data.error[0]?.message : data?.error || "Failed"
        );
      }

      const data = await res.json();
      setCreatedCode(data.card.code);
      setAmountTL("");
      setRecipientName("");
      setRecipientEmail("");
      setNote("");
      setExpirationDays("365");
      setMaxRedemptions("");
      router.refresh();
    } catch (err: any) {
      setError(err.message || "Failed");
    } finally {
      setSubmitting(false);
    }
  };

  const copyCode = () => {
    if (createdCode) {
      navigator.clipboard.writeText(createdCode);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">{d["admin.giftCards.createTitle"]}</h2>

      {createdCode && (
        <div className="mb-4 p-4 bg-green-50 border border-green-200 rounded-lg">
          <p className="text-sm font-medium text-green-800 mb-2">{d["admin.giftCards.created"]}</p>
          <div className="flex items-center gap-2">
            <code className="text-lg font-mono font-bold text-green-900">{createdCode}</code>
            <button
              onClick={copyCode}
              className="px-3 py-1 text-xs font-medium bg-green-600 text-white rounded-lg hover:bg-green-700"
            >
              {copied ? d["admin.giftCards.copied"] : d["admin.giftCards.copyCode"]}
            </button>
          </div>
        </div>
      )}

      <form onSubmit={handleSubmit} className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-6 gap-4">
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{d["admin.giftCards.amountTL"]}</label>
          <input
            type="number"
            min="1"
            max="100000"
            required
            value={amountTL}
            onChange={(e) => setAmountTL(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{d["admin.giftCards.table.recipient"]}</label>
          <input
            type="text"
            value={recipientName}
            onChange={(e) => setRecipientName(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{d["common.email"]}</label>
          <input
            type="email"
            value={recipientEmail}
            onChange={(e) => setRecipientEmail(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{d["admin.giftCards.note"]}</label>
          <input
            type="text"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder={d["admin.giftCards.notePlaceholder"]}
            maxLength={500}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{d["admin.giftCards.expiration"]}</label>
          <select
            value={expirationDays}
            onChange={(e) => setExpirationDays(e.target.value)}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
          >
            <option value="30">{d["admin.giftCards.expiration.30"]}</option>
            <option value="90">{d["admin.giftCards.expiration.90"]}</option>
            <option value="180">{d["admin.giftCards.expiration.180"]}</option>
            <option value="365">{d["admin.giftCards.expiration.365"]}</option>
            <option value="0">{d["admin.giftCards.expiration.never"]}</option>
          </select>
        </div>
        <div>
          <label className="block text-sm font-medium text-gray-700 mb-1">{d["admin.giftCards.maxRedemptions"]}</label>
          <input
            type="number"
            min="1"
            max="100000"
            value={maxRedemptions}
            onChange={(e) => setMaxRedemptions(e.target.value)}
            placeholder={d["admin.giftCards.maxRedemptionsPlaceholder"]}
            className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-green-500 focus:border-green-500"
          />
        </div>
        <div className="sm:col-span-2 lg:col-span-6 flex items-center gap-4">
          <button
            type="submit"
            disabled={submitting}
            className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
          >
            {submitting ? d["admin.giftCards.creating"] : d["admin.giftCards.create"]}
          </button>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
      </form>
    </div>
  );
}
