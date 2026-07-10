"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export function VerificationGate({
  companyName,
  alreadyUploaded,
}: {
  companyName: string;
  alreadyUploaded: boolean;
}) {
  const router = useRouter();
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(alreadyUploaded);

  const handleFiles = async (files: FileList) => {
    setError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      for (const file of Array.from(files)) fd.append("file", file);
      const res = await fetch("/api/manufacturer/printer-photo", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Yükleme başarısız");
        return;
      }
      setDone(true);
      router.refresh();
    } catch {
      setError("Bir hata oluştu");
    } finally {
      setUploading(false);
    }
  };

  return (
    <main className="min-h-screen bg-gray-50 flex items-center justify-center px-4">
      <div className="max-w-lg w-full bg-white rounded-2xl border border-gray-200 p-6 sm:p-8 text-center">
        <div className="text-3xl mb-3">🖨️</div>
        <h1 className="text-2xl font-serif text-gray-900">
          Tebrikler, {companyName}!
        </h1>
        {done ? (
          <>
            <p className="mt-3 text-gray-600">
              Yazıcı fotoğrafınız alındı. Hesabınız 24 saat içinde incelenip
              onaylanacaktır. Onaylandığında e-posta ile bilgilendirileceksiniz.
            </p>
            <span className="mt-6 inline-block px-3 py-1 rounded-full bg-amber-100 text-amber-700 text-sm font-medium">
              İnceleme bekleniyor
            </span>
            <label className="mt-6 block text-sm text-indigo-600 cursor-pointer hover:text-indigo-500">
              {uploading ? "Yükleniyor..." : "Başka yazıcı fotoğrafı ekle"}
              <input
                type="file"
                accept="image/jpeg,image/png"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
              />
            </label>
          </>
        ) : (
          <>
            <p className="mt-3 text-gray-600">
              Başvurunuz koşullu olarak onaylandı. Son adım olarak, üretimde
              kullandığınız 3D yazıcıların net fotoğraflarını yükleyin — birden
              çok yazıcınız varsa her biri için ayrı fotoğraf ekleyebilirsiniz.
              Bu, topluluk içinde güven oluşturmamıza yardımcı olur.
            </p>
            <label className="mt-6 inline-block px-6 py-3 bg-indigo-600 text-white rounded-xl font-medium cursor-pointer hover:bg-indigo-700">
              {uploading ? "Yükleniyor..." : "Yazıcı fotoğraflarını yükle"}
              <input
                type="file"
                accept="image/jpeg,image/png"
                multiple
                className="hidden"
                disabled={uploading}
                onChange={(e) => e.target.files?.length && handleFiles(e.target.files)}
              />
            </label>
            <p className="mt-3 text-xs text-gray-400">
              JPEG veya PNG, dosya başına en fazla 10MB — birden çok dosya seçebilirsiniz
            </p>
          </>
        )}
        {error && <p className="mt-4 text-sm text-red-600">{error}</p>}
      </div>
    </main>
  );
}
