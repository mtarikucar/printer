"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { ModelViewer } from "@/components/model-viewer";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency, formatDate } from "@/lib/i18n/format";
import type { AccountPreview } from "@/components/account-gallery-card";

export function AccountGalleryModal({
  preview,
  onClose,
  onPublishChanged,
}: {
  preview: AccountPreview;
  onClose: () => void;
  onPublishChanged?: (previewId: string, isPublic: boolean) => void;
}) {
  const d = useDictionary();
  const locale = useLocale();
  const [isPublic, setIsPublic] = useState(preview.order?.isPublic ?? false);

  useEffect(() => {
    const handleEsc = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    document.addEventListener("keydown", handleEsc);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", handleEsc);
      document.body.style.overflow = "";
    };
  }, [onClose]);

  const sizeLabel =
    d[`sizes.${preview.figurineSize}` as keyof typeof d] || preview.figurineSize;

  const hasBoth = !!preview.photoUrl && !!preview.glbUrl;
  const hasOrder = !!preview.order;

  return (
    <div
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div
        className={`relative card shadow-elevated w-full mx-4 overflow-hidden h-[90vh] flex flex-col animate-scale-in ${
          hasBoth ? "max-w-4xl" : "max-w-2xl"
        }`}
      >
        {/* Close button */}
        <button
          onClick={onClose}
          className="absolute top-4 right-4 z-10 p-2 bg-bg-elevated/80 backdrop-blur-sm rounded-full text-text-muted hover:text-text-primary transition-colors"
        >
          <svg
            className="w-5 h-5"
            fill="none"
            viewBox="0 0 24 24"
            stroke="currentColor"
          >
            <path
              strokeLinecap="round"
              strokeLinejoin="round"
              strokeWidth={2}
              d="M6 18L18 6M6 6l12 12"
            />
          </svg>
        </button>

        {hasBoth ? (
          <div className="flex-1 min-h-0 overflow-hidden">
            <BeforeAfterSlider
              before={
                <div className="w-full h-full bg-bg-elevated">
                  <img
                    src={preview.photoUrl}
                    alt=""
                    className="w-full h-full object-contain"
                  />
                </div>
              }
              after={
                <ModelViewer url={preview.glbUrl!} className="w-full h-full" />
              }
              beforeLabel={d["gallery.modal.originalPhoto"]}
              afterLabel={d["gallery.modal.yourFigurine"]}
            />
          </div>
        ) : (
          <div className="flex-1 min-h-0 overflow-hidden">
            {preview.glbUrl ? (
              <ModelViewer
                url={preview.glbUrl}
                className="w-full h-full rounded-t-2xl"
              />
            ) : preview.photoUrl ? (
              <div className="w-full h-full bg-bg-elevated relative">
                <img
                  src={preview.photoUrl}
                  alt=""
                  className="w-full h-full object-contain"
                />
              </div>
            ) : null}
          </div>
        )}

        {/* Info panel */}
        <div className="p-6 shrink-0">
          <div className="flex items-center justify-between flex-wrap gap-2">
            <div>
              <div className="flex items-center gap-3 text-sm text-text-muted flex-wrap">
                <span className="bg-bg-elevated text-green-500 px-2.5 py-0.5 rounded-full text-xs font-medium border border-bg-subtle">
                  {sizeLabel}
                </span>
                <span>&middot;</span>
                <span>{formatDate(preview.createdAt, locale)}</span>
                {hasOrder && (
                  <>
                    <span>&middot;</span>
                    <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-bg-elevated text-green-500 border border-bg-subtle">
                      {preview.order!.orderNumber}
                    </span>
                    <span>&middot;</span>
                    <span className="font-mono">
                      {formatCurrency(preview.order!.amountKurus, locale)}
                    </span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Publish to gallery — button opens separate modal */}
          {hasOrder && preview.glbUrl && ["approved", "printing", "shipped", "delivered"].includes(preview.order!.status) && (
            <PublishButton
              isPublic={isPublic}
              orderNumber={preview.order!.orderNumber}
              previewId={preview.id}
              initialDisplayName={preview.order!.publicDisplayName}
              onToggled={(newVal) => {
                setIsPublic(newVal);
                onPublishChanged?.(preview.id, newVal);
              }}
              d={d}
            />
          )}

          <div className="flex gap-3 mt-5">
            {hasOrder ? (
              <>
                <Link
                  href={`/track/${preview.order!.orderNumber}`}
                  className="btn-secondary flex-1 !block text-center text-sm"
                >
                  {d["account.gallery.trackOrder"]}
                </Link>
                {preview.glbUrl && (
                  <Link
                    href={`/create?previewId=${preview.id}`}
                    className="btn-primary flex-1 !block text-center text-sm"
                  >
                    {d["account.orders.reorder"]}
                  </Link>
                )}
                <Link
                  href="/create"
                  className="btn-secondary flex-1 !block text-center text-sm"
                >
                  {d["account.gallery.createAnother"]}
                </Link>
              </>
            ) : preview.glbUrl ? (
              <>
                <Link
                  href={`/create?previewId=${preview.id}`}
                  className="btn-primary flex-1 !block text-center text-sm"
                >
                  {d["account.gallery.orderThis"]}
                </Link>
                <Link
                  href="/create"
                  className="btn-secondary flex-1 !block text-center text-sm"
                >
                  {d["account.gallery.createAnother"]}
                </Link>
              </>
            ) : (
              <Link
                href="/create"
                className="btn-primary flex-1 !block text-center text-sm"
              >
                {d["account.gallery.createAnother"]}
              </Link>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Publish Button + Modal ──────────────────────────────────

const CATEGORIES = [
  { key: "character", label: "publish.category.character" },
  { key: "couple", label: "publish.category.couple" },
  { key: "family", label: "publish.category.family" },
  { key: "pet", label: "publish.category.pet" },
  { key: "fantasy", label: "publish.category.fantasy" },
  { key: "funny", label: "publish.category.funny" },
  { key: "custom", label: "publish.category.custom" },
];

const SUGGESTED_TAGS = [
  "cute", "warrior", "princess", "superhero", "wedding", "birthday",
  "graduation", "baby", "cosplay", "gaming", "sport", "music",
];

function PublishButton({
  isPublic,
  orderNumber,
  previewId,
  initialDisplayName,
  onToggled,
  d,
}: {
  isPublic: boolean;
  orderNumber: string;
  previewId: string;
  initialDisplayName?: string | null;
  onToggled: (isPublic: boolean) => void;
  d: Record<string, string>;
}) {
  const [showModal, setShowModal] = useState(false);
  const [unpublishing, setUnpublishing] = useState(false);

  const handleUnpublish = async () => {
    setUnpublishing(true);
    try {
      const res = await fetch(`/api/customer/orders/${orderNumber}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ isPublic: false }),
      });
      if (res.ok) {
        onToggled(false);
      }
    } finally {
      setUnpublishing(false);
    }
  };

  return (
    <>
      <div className="mt-4 flex gap-2">
        {isPublic ? (
          <>
            <span className="inline-flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium bg-green-500/10 text-green-600 rounded-full border border-green-500/20">
              <svg className="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
              {d["publish.published"] ?? "Published"}
            </span>
            <button
              disabled={unpublishing}
              onClick={handleUnpublish}
              className="text-xs text-orange-500 hover:text-orange-600 transition-colors disabled:opacity-50"
            >
              {unpublishing ? (d["common.loading"] ?? "...") : (d["publish.makePrivate"] ?? "Remove from Gallery")}
            </button>
          </>
        ) : (
          <button
            onClick={() => setShowModal(true)}
            className="inline-flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-500/10 text-blue-500 hover:bg-blue-500/20 border border-blue-500/20 rounded-lg transition-colors"
          >
            <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            {d["publish.makePublic"] ?? "Publish to Gallery"}
          </button>
        )}
      </div>

      {showModal && (
        <PublishModal
          orderNumber={orderNumber}
          initialDisplayName={initialDisplayName}
          onClose={() => setShowModal(false)}
          onPublished={() => {
            setShowModal(false);
            onToggled(true);
          }}
          d={d}
        />
      )}
    </>
  );
}

function PublishModal({
  orderNumber,
  initialDisplayName,
  onClose,
  onPublished,
  d,
}: {
  orderNumber: string;
  initialDisplayName?: string | null;
  onClose: () => void;
  onPublished: () => void;
  d: Record<string, string>;
}) {
  const [saving, setSaving] = useState(false);
  const [displayName, setDisplayName] = useState(initialDisplayName || "");
  const [category, setCategory] = useState("");
  const [tags, setTags] = useState<string[]>([]);
  const [tagInput, setTagInput] = useState("");

  const addTag = (tag: string) => {
    const t = tag.trim().toLowerCase();
    if (t && !tags.includes(t) && tags.length < 5) {
      setTags([...tags, t]);
    }
    setTagInput("");
  };

  const removeTag = (tag: string) => {
    setTags(tags.filter((t) => t !== tag));
  };

  const handlePublish = async () => {
    setSaving(true);
    try {
      const res = await fetch(`/api/customer/orders/${orderNumber}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          isPublic: true,
          displayName: displayName || undefined,
          category: category || undefined,
          tags: tags.length > 0 ? tags : undefined,
        }),
      });
      if (res.ok) {
        onPublished();
      } else {
        alert("Failed to publish. Please try again.");
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div
      className="fixed inset-0 z-[110] flex items-center justify-center bg-black/50 backdrop-blur-sm animate-fade-in"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="relative card shadow-elevated w-full max-w-md mx-4 p-6 animate-scale-in">
        {/* Close */}
        <button
          onClick={onClose}
          className="absolute top-3 right-3 p-1.5 rounded-full text-text-muted hover:text-text-primary hover:bg-bg-elevated transition-colors"
        >
          <svg className="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
          </svg>
        </button>

        {/* Title */}
        <div className="flex items-center gap-2 mb-5">
          <svg className="w-5 h-5 text-blue-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M3.055 11H5a2 2 0 012 2v1a2 2 0 002 2 2 2 0 012 2v2.945M8 3.935V5.5A2.5 2.5 0 0010.5 8h.5a2 2 0 012 2 2 2 0 104 0 2 2 0 012-2h1.064M15 20.488V18a2 2 0 012-2h3.064M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <h3 className="text-lg font-semibold text-text-primary">
            {d["publish.title"] ?? "Share to Gallery"}
          </h3>
        </div>

        <div className="space-y-4">
          {/* Display name */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {d["publish.displayNameLabel"] ?? "Display Name"}
            </label>
            <input
              type="text"
              value={displayName}
              onChange={(e) => setDisplayName(e.target.value)}
              placeholder={d["publish.displayNamePlaceholder"] ?? "Display name (optional)"}
              className="input-base text-sm"
            />
          </div>

          {/* Category */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {d["publish.categoryLabel"] ?? "Category"}
            </label>
            <div className="flex flex-wrap gap-1.5">
              {CATEGORIES.map((cat) => (
                <button
                  key={cat.key}
                  type="button"
                  onClick={() => setCategory(category === cat.key ? "" : cat.key)}
                  className={`px-2.5 py-1 text-xs rounded-full border transition-colors ${
                    category === cat.key
                      ? "bg-blue-600 text-white border-blue-600"
                      : "bg-bg-base text-text-secondary border-bg-subtle hover:border-blue-400"
                  }`}
                >
                  {d[cat.label as keyof typeof d] ?? cat.key}
                </button>
              ))}
            </div>
          </div>

          {/* Tags */}
          <div>
            <label className="block text-xs font-medium text-text-muted mb-1.5">
              {d["publish.tagsLabel"] ?? "Tags"} ({tags.length}/5)
            </label>
            {tags.length > 0 && (
              <div className="flex flex-wrap gap-1.5 mb-2">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 px-2 py-0.5 text-xs bg-blue-500/10 text-blue-500 rounded-full"
                  >
                    #{tag}
                    <button type="button" onClick={() => removeTag(tag)} className="hover:text-blue-700">
                      <svg className="w-3 h-3" fill="none" viewBox="0 0 24 24" stroke="currentColor"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M6 18L18 6M6 6l12 12" /></svg>
                    </button>
                  </span>
                ))}
              </div>
            )}
            {tags.length < 5 && (
              <input
                type="text"
                value={tagInput}
                onChange={(e) => setTagInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === ",") {
                    e.preventDefault();
                    addTag(tagInput);
                  }
                }}
                placeholder={d["publish.tagsPlaceholder"] ?? "Type a tag and press Enter"}
                className="input-base text-sm mb-2"
              />
            )}
            <div className="flex flex-wrap gap-1">
              {SUGGESTED_TAGS.filter((t) => !tags.includes(t)).slice(0, 8).map((tag) => (
                <button
                  key={tag}
                  type="button"
                  onClick={() => addTag(tag)}
                  className="px-2 py-0.5 text-[10px] text-text-muted bg-bg-base border border-bg-subtle rounded-full hover:border-blue-400 hover:text-blue-500 transition-colors"
                >
                  +{tag}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* Actions */}
        <div className="flex gap-3 mt-6">
          <button
            onClick={onClose}
            className="btn-secondary flex-1 text-sm"
          >
            {d["common.cancel"] ?? "Cancel"}
          </button>
          <button
            disabled={saving}
            onClick={handlePublish}
            className="btn-primary flex-1 text-sm !bg-blue-500 hover:!bg-blue-600 disabled:opacity-50"
          >
            {saving ? (d["common.loading"] ?? "...") : (d["publish.makePublic"] ?? "Publish to Gallery")}
          </button>
        </div>
      </div>
    </div>
  );
}
