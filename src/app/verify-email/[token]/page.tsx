"use client";

import { useState, use, useEffect, useRef } from "react";
import Link from "next/link";
import { SiteHeader } from "@/components/site-header";
import { useDictionary } from "@/lib/i18n/locale-context";
import { Card } from "@/components/ui";

export default function VerifyEmailPage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = use(params);
  const d = useDictionary();
  const [state, setState] = useState<"loading" | "success" | "error">("loading");
  const ran = useRef(false);

  useEffect(() => {
    if (ran.current) return; // guard React 18 strict-mode double-invoke
    ran.current = true;
    (async () => {
      try {
        const res = await fetch("/api/auth/verify-email", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ token }),
        });
        setState(res.ok ? "success" : "error");
      } catch {
        setState("error");
      }
    })();
  }, [token]);

  return (
    <>
      <SiteHeader />
      <main className="mx-auto flex min-h-[60vh] max-w-md flex-col items-center justify-center px-4">
        <Card className="w-full p-8 text-center">
          {state === "loading" && (
            <p className="text-text-secondary">
              {d["verifyEmail.checking" as keyof typeof d] || "Doğrulanıyor…"}
            </p>
          )}
          {state === "success" && (
            <>
              <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-green-100 text-green-600">
                <svg className="h-6 w-6" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </div>
              <h1 className="mb-2 text-xl font-bold text-text-primary">
                {d["verifyEmail.successTitle" as keyof typeof d] || "E-postanız doğrulandı"}
              </h1>
              <p className="mb-6 text-sm text-text-secondary">
                {d["verifyEmail.successBody" as keyof typeof d] ||
                  "Artık tasarım oluşturmaya başlayabilirsiniz."}
              </p>
              <Link
                href="/create"
                className="inline-block rounded-xl bg-green-500 px-6 py-2.5 font-medium text-white hover:bg-green-400"
              >
                {d["verifyEmail.cta" as keyof typeof d] || "Tasarım oluştur"}
              </Link>
            </>
          )}
          {state === "error" && (
            <>
              <h1 className="mb-2 text-xl font-bold text-text-primary">
                {d["verifyEmail.errorTitle" as keyof typeof d] || "Bağlantı geçersiz"}
              </h1>
              <p className="mb-6 text-sm text-text-secondary">
                {d["verifyEmail.errorBody" as keyof typeof d] ||
                  "Bağlantının süresi dolmuş veya zaten kullanılmış olabilir. Hesabınızdan yeni bir doğrulama e-postası isteyin."}
              </p>
              <Link
                href="/create"
                className="inline-block rounded-xl border border-bg-subtle px-6 py-2.5 font-medium text-text-primary hover:bg-bg-subtle/30"
              >
                {d["verifyEmail.backCta" as keyof typeof d] || "Devam et"}
              </Link>
            </>
          )}
        </Card>
      </main>
    </>
  );
}
