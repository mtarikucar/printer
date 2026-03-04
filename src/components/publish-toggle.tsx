"use client";

import { useState } from "react";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDateLong } from "@/lib/i18n/format";

export function PublishToggle({
  orderNumber,
  initialIsPublic,
  initialDisplayName,
  initialPublishedAt,
}: {
  orderNumber: string;
  initialIsPublic: boolean;
  initialDisplayName: string | null;
  initialPublishedAt: string | null;
}) {
  const d = useDictionary();
  const locale = useLocale();
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [displayName, setDisplayName] = useState(initialDisplayName || "");
  const [publishedAt, setPublishedAt] = useState(initialPublishedAt);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const handleToggle = async () => {
    const newIsPublic = !isPublic;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(
        `/api/customer/orders/${orderNumber}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isPublic: newIsPublic,
            displayName: newIsPublic ? displayName || undefined : undefined,
          }),
        }
      );

      if (res.ok) {
        setIsPublic(newIsPublic);
        if (newIsPublic && !publishedAt) {
          setPublishedAt(new Date().toISOString());
        }
        setMessage(newIsPublic ? d["publish.success"] : d["publish.removed"]);
      } else {
        setMessage(d["publish.failed"]);
      }
    } catch {
      setMessage(d["publish.failed"]);
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 3000);
    }
  };

  return (
    <div className="card p-6">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-base font-semibold text-gray-900">
          {d["publish.title"]}
        </h3>
      </div>
      <p className="mt-1 text-sm text-gray-500">{d["publish.description"]}</p>

      {!isPublic && (
        <div className="mt-4">
          <label className="block text-sm font-medium text-gray-700 mb-1.5">
            {d["publish.displayName"]}
          </label>
          <input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={d["publish.displayNamePlaceholder"]}
            className="input-base"
          />
        </div>
      )}

      <button
        onClick={handleToggle}
        disabled={saving}
        className={`mt-4 w-full ${isPublic ? "btn-secondary" : "btn-primary"} !block text-center text-sm`}
      >
        {saving
          ? d["common.loading"]
          : isPublic
            ? d["publish.makePrivate"]
            : d["publish.makePublic"]}
      </button>

      {isPublic && publishedAt && (
        <p className="mt-3 text-xs text-gray-400 flex items-center gap-1.5">
          <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8.684 13.342C8.886 12.938 9 12.482 9 12c0-.482-.114-.938-.316-1.342m0 2.684a3 3 0 110-2.684m0 2.684l6.632 3.316m-6.632-6l6.632-3.316m0 0a3 3 0 105.367-2.684 3 3 0 00-5.367 2.684zm0 9.316a3 3 0 105.368 2.684 3 3 0 00-5.368-2.684z" />
          </svg>
          {d["publish.sharedSince"]} {formatDateLong(publishedAt, locale)}
        </p>
      )}

      {message && (
        <p
          className={`mt-3 text-sm text-center animate-fade-in ${
            message === d["publish.failed"]
              ? "text-error-500"
              : "text-success-500"
          }`}
        >
          {message}
        </p>
      )}
    </div>
  );
}
