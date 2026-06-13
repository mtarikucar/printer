"use client";

import * as Sentry from "@sentry/nextjs";
import { useEffect } from "react";

/**
 * Root error boundary. Next.js renders this when an error escapes the route
 * segments (it must declare its own <html>/<body>). We forward the error to
 * Sentry (no-op without a DSN) and show a minimal recovery UI.
 */
export default function GlobalError({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    Sentry.captureException(error);
  }, [error]);

  return (
    <html lang="tr">
      <body
        style={{
          fontFamily: "system-ui, sans-serif",
          display: "flex",
          minHeight: "100vh",
          alignItems: "center",
          justifyContent: "center",
          margin: 0,
          background: "#fafafa",
          color: "#111",
        }}
      >
        <div style={{ textAlign: "center", padding: "2rem", maxWidth: 420 }}>
          <h1 style={{ fontSize: "1.25rem", marginBottom: "0.5rem" }}>
            Bir şeyler ters gitti
          </h1>
          <p style={{ color: "#666", fontSize: "0.9rem", marginBottom: "1.5rem" }}>
            Beklenmeyen bir hata oluştu. Tekrar denemek için aşağıdaki düğmeyi
            kullanın.
          </p>
          <button
            onClick={() => reset()}
            style={{
              background: "#111",
              color: "#fff",
              border: "none",
              borderRadius: "0.75rem",
              padding: "0.6rem 1.5rem",
              fontSize: "0.9rem",
              cursor: "pointer",
            }}
          >
            Tekrar dene
          </button>
        </div>
      </body>
    </html>
  );
}
