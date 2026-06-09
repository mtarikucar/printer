"use client";

import { useEffect, useState } from "react";
import { useDictionary } from "@/lib/i18n/locale-context";

interface Review {
  rating: number;
  title: string | null;
  body: string | null;
  customerName: string;
}

function Stars({ value, onChange }: { value: number; onChange?: (n: number) => void }) {
  return (
    <div className="flex gap-0.5">
      {[1, 2, 3, 4, 5].map((n) => (
        <button
          key={n}
          type="button"
          disabled={!onChange}
          onClick={() => onChange?.(n)}
          className={n <= value ? "text-amber-400" : "text-bg-subtle"}
          aria-label={`${n}`}
        >
          <svg className="h-5 w-5" fill="currentColor" viewBox="0 0 20 20">
            <path d="M9.049 2.927c.3-.921 1.603-.921 1.902 0l1.07 3.292a1 1 0 00.95.69h3.462c.969 0 1.371 1.24.588 1.81l-2.8 2.034a1 1 0 00-.364 1.118l1.07 3.292c.3.921-.755 1.688-1.54 1.118l-2.8-2.034a1 1 0 00-1.175 0l-2.8 2.034c-.784.57-1.838-.197-1.539-1.118l1.07-3.292a1 1 0 00-.364-1.118L2.98 8.72c-.783-.57-.38-1.81.588-1.81h3.461a1 1 0 00.951-.69l1.07-3.292z" />
          </svg>
        </button>
      ))}
    </div>
  );
}

export function ProductReviews({ productId }: { productId: string }) {
  const d = useDictionary();
  const [reviews, setReviews] = useState<Review[]>([]);
  const [avg, setAvg] = useState(0);
  const [count, setCount] = useState(0);
  const [rating, setRating] = useState(5);
  const [body, setBody] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);
  const [gated, setGated] = useState(false);

  const load = () =>
    fetch(`/api/products/${productId}/reviews`)
      .then((r) => (r.ok ? r.json() : null))
      .then((dd) => {
        if (dd) {
          setReviews(dd.reviews);
          setAvg(dd.avg);
          setCount(dd.count);
        }
      });

  useEffect(() => {
    load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [productId]);

  const submit = async () => {
    setSubmitting(true);
    setGated(false);
    try {
      const r = await fetch(`/api/products/${productId}/reviews`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ rating, body }),
      });
      if (r.ok) {
        setDone(true);
        setBody("");
        load();
      } else if (r.status === 403 || r.status === 401) {
        setGated(true);
      }
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="mt-12 border-t border-border-default pt-8">
      <div className="flex items-center gap-3">
        <h2 className="font-serif text-xl text-text-primary">{d["review.title"]}</h2>
        {count > 0 && (
          <span className="flex items-center gap-1 text-sm text-text-muted">
            <Stars value={Math.round(avg)} /> {avg.toFixed(1)} ({count})
          </span>
        )}
      </div>

      {done ? (
        <p className="mt-4 text-sm font-medium text-green-600">{d["review.thanks"]}</p>
      ) : (
        <div className="card mt-4 p-4">
          <p className="mb-2 text-sm font-medium text-text-primary">{d["review.write"]}</p>
          <Stars value={rating} onChange={setRating} />
          <textarea
            value={body}
            onChange={(e) => setBody(e.target.value)}
            placeholder={d["review.bodyPlaceholder"]}
            rows={3}
            className="mt-3 w-full rounded-xl border border-bg-subtle bg-bg-base px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
          />
          {gated && <p className="mt-2 text-xs text-text-muted">{d["review.gated"]}</p>}
          <button
            onClick={submit}
            disabled={submitting}
            className="mt-3 rounded-full bg-green-600 px-5 py-2 text-sm font-semibold text-white transition-colors hover:bg-green-700 disabled:opacity-60"
          >
            {submitting ? "…" : d["review.submit"]}
          </button>
        </div>
      )}

      <div className="mt-6 space-y-4">
        {reviews.length === 0 ? (
          <p className="text-sm text-text-muted">{d["review.none"]}</p>
        ) : (
          reviews.map((r, i) => (
            <div key={i} className="border-b border-border-default pb-3 last:border-0">
              <div className="flex items-center gap-2">
                <Stars value={r.rating} />
                <span className="text-sm font-medium text-text-primary">{r.customerName}</span>
              </div>
              {r.title && <p className="mt-1 text-sm font-medium text-text-primary">{r.title}</p>}
              {r.body && <p className="mt-1 text-sm text-text-secondary">{r.body}</p>}
            </div>
          ))
        )}
      </div>
    </div>
  );
}
