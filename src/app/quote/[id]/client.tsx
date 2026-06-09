"use client";

import { ModelViewer } from "@/components/model-viewer";
import { CheckoutForm } from "@/components/checkout/checkout-form";
import { useDictionary, useLocale } from "@/lib/i18n/locale-context";
import { formatCurrency } from "@/lib/i18n/format";

interface QuoteModel {
  id: string;
  fileName: string;
  status: string;
  quoteStatus: string;
  quotedPriceKurus: number | null;
  priceKurus: number | null;
  glbPreviewUrl: string | null;
}

export function QuoteClient({ model }: { model: QuoteModel }) {
  const d = useDictionary();
  const locale = useLocale();

  const quoted = model.quoteStatus === "quoted" && model.quotedPriceKurus != null;
  const auto = model.status === "ready" && model.priceKurus != null;
  const price = quoted ? model.quotedPriceKurus! : auto ? model.priceKurus! : null;

  return (
    <section className="mx-auto max-w-2xl px-5 py-12 md:py-16">
      <h1
        className="text-center text-3xl text-text-primary md:text-4xl"
        style={{ fontFamily: "var(--font-display)" }}
      >
        {d["quote.title"]}
      </h1>
      <p className="mt-2 text-center text-sm text-text-muted">{model.fileName}</p>

      {model.glbPreviewUrl && (
        <div className="card mt-6 overflow-hidden">
          <ModelViewer url={model.glbPreviewUrl} previewMode />
        </div>
      )}

      {price != null ? (
        <div className="card mt-6 p-6">
          <p className="text-center text-sm text-text-muted">{d["quote.price"]}</p>
          <p className="mt-1 text-center text-3xl font-semibold text-text-primary">
            {formatCurrency(price, locale)}
          </p>
          <div className="mt-6">
            <CheckoutForm
              orderPayload={{ orderType: "upload", uploadedModelId: model.id }}
              priceKurus={price}
              submitLabel={d["upload.placeOrder"]}
            />
          </div>
        </div>
      ) : (
        <div className="card mt-6 p-8 text-center">
          <p className="text-text-secondary">{d["quote.pending"]}</p>
        </div>
      )}
    </section>
  );
}
