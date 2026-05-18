"use client";

import { useState } from "react";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatDateLong } from "@/lib/i18n/format";
import { Button, Card, Input, FormField } from "@/components/ui";

type ReviewStatus = "none" | "pending" | "approved" | "rejected";

export function PublishToggle({
  orderNumber,
  initialIsPublic,
  initialDisplayName,
  initialPublishedAt,
  initialReviewStatus = "none",
  initialReviewReason = null,
}: {
  orderNumber: string;
  initialIsPublic: boolean;
  initialDisplayName: string | null;
  initialPublishedAt: string | null;
  initialReviewStatus?: ReviewStatus;
  initialReviewReason?: string | null;
}) {
  const d = useDictionary();
  const locale = useLocale();
  const [isPublic, setIsPublic] = useState(initialIsPublic);
  const [reviewStatus, setReviewStatus] =
    useState<ReviewStatus>(initialReviewStatus);
  const [displayName, setDisplayName] = useState(initialDisplayName || "");
  const [publishedAt, setPublishedAt] = useState(initialPublishedAt);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  // Customer-facing publish has three meaningful states now (after Q4):
  //   isPublic + reviewStatus=approved  → live in gallery
  //   reviewStatus=pending              → submitted, waiting for admin
  //   reviewStatus=rejected             → admin declined, show reason
  //   reviewStatus=none && !isPublic    → never submitted (default)
  const isPending = reviewStatus === "pending";
  const isRejected = reviewStatus === "rejected";
  const isLive = isPublic && reviewStatus === "approved";

  const handleToggle = async () => {
    // If currently live OR pending review, this button means "withdraw".
    // Otherwise it means "submit for review".
    const willSubmit = !isLive && !isPending;
    setSaving(true);
    setMessage(null);

    try {
      const res = await fetch(
        `/api/customer/orders/${orderNumber}/publish`,
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            isPublic: willSubmit,
            displayName: willSubmit ? displayName || undefined : undefined,
          }),
        }
      );

      if (res.ok) {
        if (willSubmit) {
          setReviewStatus("pending");
          setMessage(d["publish.pendingSubmitted"]);
        } else {
          setIsPublic(false);
          setReviewStatus("none");
          setPublishedAt(null);
          setMessage(d["publish.removed"]);
        }
      } else {
        setMessage(d["publish.failed"]);
      }
    } catch {
      setMessage(d["publish.failed"]);
    } finally {
      setSaving(false);
      setTimeout(() => setMessage(null), 4000);
    }
  };

  return (
    <Card padding="md">
      <div className="flex items-center gap-2">
        <svg className="w-5 h-5 text-green-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
        </svg>
        <h3 className="text-base font-semibold text-text-primary">
          {d["publish.title"]}
        </h3>
      </div>
      <p className="mt-1 text-sm text-text-muted">{d["publish.description"]}</p>

      {/* Gift-card incentive teaser — only shown when the customer can still
          submit. Drives the conversion from "anonymous private order" to
          "active gallery contributor". Copy intentionally says "may" so we
          don't promise a reward every time. */}
      {!isLive && !isPending && (
        <div className="mt-3 bg-amber-500/10 border border-amber-500/20 rounded-lg p-3 text-xs text-amber-700">
          🎁 {d["publish.rewardHint"]}
        </div>
      )}

      {/* Status banners (pending / rejected / approved). Each replaces the
          form + toggle so the customer sees the current state clearly. */}
      {isPending && (
        <div className="mt-4 bg-blue-50 border border-blue-200 rounded-xl p-4 text-sm text-blue-900">
          <p className="font-semibold mb-1">{d["publish.pendingTitle"]}</p>
          <p>{d["publish.pendingBody"]}</p>
        </div>
      )}

      {isRejected && (
        <div className="mt-4 bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-900">
          <p className="font-semibold mb-1">{d["publish.rejectedTitle"]}</p>
          <p>{d["publish.rejectedBody"]}</p>
          {initialReviewReason && (
            <p className="mt-2 text-xs">
              <strong>{d["publish.rejectedReasonLabel"]}</strong> {initialReviewReason}
            </p>
          )}
        </div>
      )}

      {!isLive && !isPending && (
        <FormField label={d["publish.displayName"]} className="mt-4">
          <Input
            type="text"
            value={displayName}
            onChange={(e) => setDisplayName(e.target.value)}
            placeholder={d["publish.displayNamePlaceholder"]}
          />
        </FormField>
      )}

      <Button
        onClick={handleToggle}
        loading={saving}
        variant={isLive || isPending ? "secondary" : "primary"}
        fullWidth
        size="sm"
        className="mt-4 !block text-center"
      >
        {saving
          ? d["common.loading"]
          : isLive
            ? d["publish.makePrivate"]
            : isPending
              ? d["publish.withdraw"]
              : d["publish.submit"]}
      </Button>

      {isLive && publishedAt && (
        <p className="mt-3 text-xs text-text-muted flex items-center gap-1.5">
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
              ? "text-error"
              : "text-success"
          }`}
        >
          {message}
        </p>
      )}
    </Card>
  );
}
