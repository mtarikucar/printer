"use client";

import { useDictionary } from "@/lib/i18n/locale-context";
import type { Dictionary } from "@/lib/i18n/dictionaries";

function getSteps(d: Dictionary) {
  return [
    { key: "paid", label: d["tracker.paid.label"], description: d["tracker.paid.description"] },
    { key: "generating", label: d["tracker.generating.label"], description: d["tracker.generating.description"] },
    { key: "processing_mesh", label: d["tracker.processing_mesh.label"], description: d["tracker.processing_mesh.description"] },
    { key: "review", label: d["tracker.review.label"], description: d["tracker.review.description"] },
    { key: "approved", label: d["tracker.approved.label"], description: d["tracker.approved.description"] },
    { key: "printing", label: d["tracker.printing.label"], description: d["tracker.printing.description"] },
    { key: "shipped", label: d["tracker.shipped.label"], description: d["tracker.shipped.description"] },
    { key: "delivered", label: d["tracker.delivered.label"], description: d["tracker.delivered.description"] },
  ] as const;
}

const FAILED_STATUSES = [
  "failed_generation",
  "failed_mesh",
  "rejected",
] as const;

export function OrderStatusTracker({
  status,
  trackingNumber,
}: {
  status: string;
  trackingNumber?: string | null;
}) {
  const d = useDictionary();
  const STEPS = getSteps(d);
  const isFailed = (FAILED_STATUSES as readonly string[]).includes(status);
  const currentIndex = STEPS.findIndex((s) => s.key === status);

  if (isFailed) {
    return (
      <div className="card bg-gradient-to-r from-amber-50 to-orange-50 border-l-4 border-amber-400 p-6">
        <div className="flex items-start gap-4">
          <div className="w-12 h-12 bg-amber-100 rounded-full flex items-center justify-center shrink-0">
            <svg className="w-6 h-6 text-amber-600" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.964-.833-2.732 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z" />
            </svg>
          </div>
          <div>
            <h3 className="text-lg font-semibold text-amber-800">
              {d["tracker.failed.title"]}
            </h3>
            <p className="text-amber-700 mt-1">
              {d["tracker.failed.message"]}
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {STEPS.map((step, index) => {
        const isCompleted = index < currentIndex;
        const isCurrent = index === currentIndex;
        const isPending = index > currentIndex;

        return (
          <div key={step.key} className="flex items-start gap-4">
            <div className="flex flex-col items-center">
              <div
                className={`w-9 h-9 rounded-full flex items-center justify-center text-sm font-bold transition-all ${
                  isCompleted
                    ? "bg-gradient-to-br from-green-400 to-emerald-500 text-white shadow-sm"
                    : isCurrent
                      ? "bg-gradient-to-br from-primary-500 to-accent-500 text-white ring-4 ring-primary-100"
                      : "bg-surface-200 text-gray-400"
                }`}
              >
                {isCompleted ? (
                  <svg
                    className="w-4 h-4"
                    fill="none"
                    viewBox="0 0 24 24"
                    stroke="currentColor"
                  >
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={3}
                      d="M5 13l4 4L19 7"
                    />
                  </svg>
                ) : (
                  index + 1
                )}
              </div>
              {index < STEPS.length - 1 && (
                <div
                  className={`w-1 h-8 rounded-full ${
                    isCompleted
                      ? "bg-gradient-to-b from-green-400 to-emerald-500"
                      : "bg-surface-200"
                  }`}
                />
              )}
            </div>
            <div className={`pb-6 ${isPending ? "opacity-40" : ""}`}>
              <p
                className={`font-semibold ${
                  isCurrent ? "text-primary-600 font-bold" : "text-gray-900"
                }`}
              >
                {step.label}
              </p>
              <p className="text-sm text-gray-500">{step.description}</p>
              {step.key === "shipped" && isCurrent && trackingNumber && (
                <p className="mt-1.5 inline-flex items-center gap-1.5">
                  <svg className="w-4 h-4 text-primary-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17.657 16.657L13.414 20.9a1.998 1.998 0 01-2.827 0l-4.244-4.243a8 8 0 1111.314 0z" />
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 11a3 3 0 11-6 0 3 3 0 016 0z" />
                  </svg>
                  <span className="bg-primary-50 text-primary-700 font-mono px-3 py-1 rounded-lg text-sm">
                    {d["tracker.tracking"]} {trackingNumber}
                  </span>
                </p>
              )}
            </div>
          </div>
        );
      })}
    </div>
  );
}
