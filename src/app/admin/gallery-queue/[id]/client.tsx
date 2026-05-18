"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import dynamic from "next/dynamic";

const ModelViewer = dynamic(
  () => import("@/components/model-viewer").then((m) => m.ModelViewer),
  { ssr: false }
);

interface ReviewData {
  id: string;
  orderNumber: string;
  customerName: string;
  email: string;
  figurineSize: string;
  style: string;
  modifiers: string[];
  publicDisplayName: string | null;
  galleryCategory: string | null;
  galleryTags: string[];
  galleryReviewStatus: string;
  galleryReviewReason: string | null;
  createdAt: string;
  photoUrl: string | null;
  glbUrl: string | null;
}

const CATEGORIES = [
  "character",
  "couple",
  "family",
  "pet",
  "fantasy",
  "funny",
  "custom",
];

export function GalleryReviewClient({ review }: { review: ReviewData }) {
  const router = useRouter();
  const [displayName, setDisplayName] = useState(review.publicDisplayName ?? "");
  const [category, setCategory] = useState(review.galleryCategory ?? "");
  const [tagsInput, setTagsInput] = useState(review.galleryTags.join(", "));
  const [rejectReason, setRejectReason] = useState("");
  const [rewardAmount, setRewardAmount] = useState(100); // TL
  const [loading, setLoading] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const parsedTags = tagsInput
    .split(",")
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .slice(0, 5);

  const callEndpoint = async (
    path: string,
    payload: Record<string, unknown>
  ) => {
    setError(null);
    try {
      const res = await fetch(path, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "İşlem başarısız");
        return false;
      }
      return true;
    } catch {
      setError("Bir hata oluştu");
      return false;
    }
  };

  const approve = async () => {
    setLoading("approve");
    const ok = await callEndpoint(
      `/api/admin/gallery/${review.id}/approve`,
      {
        category: category || null,
        tags: parsedTags,
        displayName: displayName || null,
      }
    );
    setLoading(null);
    if (ok) router.push("/admin/gallery-queue");
  };

  const reject = async () => {
    if (!rejectReason.trim()) {
      setError("Lütfen reddetme sebebi girin");
      return;
    }
    if (!confirm("Bu başvuruyu reddedip müşteriye bildirim göndermek istediğinize emin misiniz?"))
      return;
    setLoading("reject");
    const ok = await callEndpoint(
      `/api/admin/gallery/${review.id}/reject`,
      { reason: rejectReason }
    );
    setLoading(null);
    if (ok) router.push("/admin/gallery-queue");
  };

  const reward = async () => {
    if (rewardAmount < 10 || rewardAmount > 2000) {
      setError("Hediye çeki tutarı 10-2000 TL arası olmalı");
      return;
    }
    if (
      !confirm(
        `${rewardAmount} TL değerinde hediye çeki oluşturulacak ve müşteriye e-posta gönderilecek. Devam edilsin mi?`
      )
    )
      return;
    setLoading("reward");
    const ok = await callEndpoint(
      `/api/admin/gallery/${review.id}/reward`,
      {
        giftCardAmountTL: rewardAmount,
        category: category || null,
        tags: parsedTags,
        displayName: displayName || null,
      }
    );
    setLoading(null);
    if (ok) router.push("/admin/gallery-queue");
  };

  const isPending = review.galleryReviewStatus === "pending";

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between">
        <div>
          <Link
            href="/admin/gallery-queue"
            className="text-sm text-indigo-600 hover:underline"
          >
            ← Galeri Kuyruğu
          </Link>
          <h1 className="text-2xl font-bold text-gray-900 mt-2">
            <span className="font-mono">{review.orderNumber}</span>
          </h1>
          <p className="text-sm text-gray-500 mt-1">
            {review.customerName} · {review.email}
          </p>
          <p className="text-xs text-gray-400 mt-1">
            Başvuru: {new Date(review.createdAt).toLocaleString("tr-TR")} · {review.figurineSize} · {review.style}
            {review.modifiers.length > 0 && ` · ${review.modifiers.join(", ")}`}
          </p>
        </div>
        <span
          className={`px-3 py-1 rounded-full text-xs font-semibold ${
            review.galleryReviewStatus === "pending"
              ? "bg-blue-100 text-blue-700"
              : review.galleryReviewStatus === "approved"
              ? "bg-emerald-100 text-emerald-700"
              : review.galleryReviewStatus === "rejected"
              ? "bg-red-100 text-red-700"
              : "bg-gray-100 text-gray-700"
          }`}
        >
          {review.galleryReviewStatus}
        </span>
      </div>

      {!isPending && review.galleryReviewReason && (
        <div className="bg-red-50 border border-red-200 rounded-xl p-4 text-sm text-red-900">
          <strong>Red sebebi:</strong> {review.galleryReviewReason}
        </div>
      )}

      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            Müşteri fotoğrafı
          </h2>
          {review.photoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={review.photoUrl}
              alt={review.orderNumber}
              className="w-full rounded-lg object-cover max-h-96 bg-gray-50"
            />
          ) : (
            <p className="text-sm text-gray-400">Fotoğraf yok</p>
          )}
        </section>

        <section className="bg-white rounded-xl border border-gray-200 p-5">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500 mb-3">
            3D model
          </h2>
          {review.glbUrl ? (
            <div className="h-96 rounded-lg overflow-hidden bg-gray-50">
              <ModelViewer url={review.glbUrl} className="w-full h-full" />
            </div>
          ) : (
            <p className="text-sm text-gray-400">GLB hazır değil</p>
          )}
        </section>
      </div>

      {isPending && (
        <section className="bg-white rounded-xl border border-gray-200 p-5 space-y-4">
          <h2 className="text-xs font-semibold uppercase tracking-wide text-gray-500">
            Yayın bilgileri
          </h2>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
            <label className="text-sm">
              <span className="text-gray-700">Görünür isim</span>
              <input
                type="text"
                value={displayName}
                onChange={(e) => setDisplayName(e.target.value)}
                placeholder="(Anonim)"
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
              />
            </label>
            <label className="text-sm">
              <span className="text-gray-700">Kategori</span>
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm bg-white"
              >
                <option value="">(Yok)</option>
                {CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="text-gray-700">Etiketler (virgülle, max 5)</span>
              <input
                type="text"
                value={tagsInput}
                onChange={(e) => setTagsInput(e.target.value)}
                placeholder="aile, bebek, sevimli"
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm"
              />
            </label>
          </div>

          {error && (
            <div className="bg-red-50 text-red-700 text-sm rounded-xl p-3">
              {error}
            </div>
          )}

          <div className="border-t border-gray-100 pt-4">
            <div className="flex flex-wrap gap-2">
              <button
                onClick={approve}
                disabled={loading !== null}
                className="px-5 py-2 bg-emerald-600 text-white rounded-xl text-sm font-semibold hover:bg-emerald-700 disabled:bg-gray-300"
              >
                {loading === "approve" ? "Onaylanıyor..." : "Onayla ve yayınla"}
              </button>
              <div className="inline-flex gap-2 items-center">
                <input
                  type="number"
                  min={10}
                  max={2000}
                  step={10}
                  value={rewardAmount}
                  onChange={(e) => setRewardAmount(Number(e.target.value))}
                  className="w-24 px-3 py-2 border border-gray-200 rounded-xl text-sm"
                />
                <span className="text-sm text-gray-500">TL</span>
                <button
                  onClick={reward}
                  disabled={loading !== null}
                  className="px-5 py-2 bg-amber-500 text-white rounded-xl text-sm font-semibold hover:bg-amber-600 disabled:bg-gray-300"
                >
                  {loading === "reward"
                    ? "Hediye ediliyor..."
                    : "Hediye çeki + onayla"}
                </button>
              </div>
            </div>
          </div>

          <div className="border-t border-gray-100 pt-4">
            <label className="text-sm block mb-2">
              <span className="text-gray-700">Red sebebi (müşteri görür)</span>
              <textarea
                value={rejectReason}
                onChange={(e) => setRejectReason(e.target.value)}
                rows={2}
                maxLength={500}
                placeholder="Örn: Fotoğraf telif hakkı korumalı içerik içeriyor"
                className="mt-1 w-full px-3 py-2 border border-gray-200 rounded-xl text-sm resize-none"
              />
            </label>
            <button
              onClick={reject}
              disabled={loading !== null || !rejectReason.trim()}
              className="px-5 py-2 bg-red-100 text-red-700 rounded-xl text-sm font-semibold hover:bg-red-200 disabled:bg-gray-100"
            >
              {loading === "reject" ? "Reddediliyor..." : "Reddet"}
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
