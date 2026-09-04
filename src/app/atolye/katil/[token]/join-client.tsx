"use client";

import { useEffect, useId, useRef, useState } from "react";
import Link from "next/link";
import { Button, Card, FormField, Input } from "@/components/ui";
import { ContentConsent } from "@/components/content-consent";
import { PhoneInput, phoneInputToE164 } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { UPLOAD_MAX_SIZE_BYTES } from "@/lib/config/upload";
import { uploadWithProgress } from "@/lib/upload-with-progress";
import type { JoinView } from "@/lib/services/workshop-join";

function formatDateTime(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    dateStyle: "full",
    timeStyle: "short",
  });
}

function formatDeadline(iso: string): string {
  return new Date(iso).toLocaleString("tr-TR", {
    dateStyle: "long",
    timeStyle: "short",
  });
}

const ACCEPTED_PHOTO_TYPES = ["image/jpeg", "image/png"];

/**
 * Public katılım sayfasının gövdesi.
 *
 * Seans kapalıysa yalnızca kapanış nedenini gösterir. Açık seansta bilgi
 * kartının altına katılım formu eklenir: ad/e-posta/telefon, fotoğraf (submit
 * anında `/api/upload`'a Turnstile token'ıyla yüklenir), içerik/KVKK onayları
 * ve gönderim `/api/workshop/join/<token>`'a gider — başarı `payUrl`'e tam
 * sayfa yönlendirmedir.
 */
export function JoinClient({
  token,
  view,
}: {
  token: string;
  view: JoinView;
}) {
  const remaining = Math.max(0, view.capacity - view.bookedCount);

  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState("");
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);
  const [consentOk, setConsentOk] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // Sunucunun makine-okunabilir hata kodu (bkz. workshop-participant.ts'teki
  // JoinErrorCode) — "kayıtlı e-posta" özel UI'ı BUNA göre dallanır, Türkçe
  // mesaj metnine göre DEĞİL: metin bir ifade düzeltmesiyle değişebilir, kod
  // değişmez.
  const [errorCode, setErrorCode] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const turnstileRef = useRef<TurnstileRef>(null);

  // Seçilen fotoğrafın blob URL'i yalnızca bu tarayıcı sekmesinde yaşar —
  // her değişimde ve unmount'ta serbest bırak (bkz. upload-dropzone.tsx).
  useEffect(() => {
    return () => {
      if (photoPreview) URL.revokeObjectURL(photoPreview);
    };
  }, [photoPreview]);

  if (!view.open) {
    return (
      <main className="min-h-screen bg-bg-base">
        <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">
          <p className="text-xs font-medium uppercase tracking-wider text-green-600">
            Figurunica Atölye
          </p>
          <h1 className="font-display text-3xl sm:text-4xl text-text-primary mt-2 mb-8">
            {view.venueName}
          </h1>
          <Card padding="lg">
            <h2 className="text-lg font-semibold text-text-primary">
              Bu atölyeye şu anda katılım mümkün değil
            </h2>
            <p className="text-text-secondary mt-2">{view.closedReason}</p>
          </Card>
          <p className="text-center text-xs text-text-muted mt-8">
            Bu sayfa yalnızca bağlantıyı bilenlere açıktır.
          </p>
        </div>
      </main>
    );
  }

  const handlePhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0] ?? null;
    setPhotoError(null);
    if (!file) {
      setPhotoFile(null);
      setPhotoPreview(null);
      return;
    }
    if (!ACCEPTED_PHOTO_TYPES.includes(file.type)) {
      setPhotoError("Yalnızca JPEG veya PNG dosyası yükleyebilirsiniz.");
      setPhotoFile(null);
      setPhotoPreview(null);
      e.target.value = "";
      return;
    }
    if (file.size > UPLOAD_MAX_SIZE_BYTES) {
      setPhotoError("Dosya 20 MB sınırını aşıyor.");
      setPhotoFile(null);
      setPhotoPreview(null);
      e.target.value = "";
      return;
    }
    setPhotoFile(file);
    setPhotoPreview(URL.createObjectURL(file));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    // Savunma amaçlı ikinci kilit: buton `disabled`'ı çift tıklamayı ve Enter
    // ile örtük gönderimi normalde zaten engeller, ama bu satır o varsayıma
    // bağımlı KALMAZ — form yine de ikinci kez submit edilirse (bir tarayıcı
    // kenar durumu, gelecekte eklenecek başka bir tetikleyici) ikinci bir
    // koltuk rezervasyonu / taslak açılmaz. Bir koltuk burada gerçek bir
    // maliyettir.
    if (submitting) return;
    setError(null);
    setErrorCode(null);

    const phoneE164 = phoneInputToE164(phoneCountry, phone);
    if (!phoneE164) {
      setError("Geçerli bir telefon numarası girin.");
      return;
    }
    if (!photoFile) {
      setPhotoError("Bir fotoğraf seçin.");
      return;
    }
    if (!consentOk) {
      setError("Devam etmek için görsel kullanım ve KVKK onaylarını işaretlemelisiniz.");
      return;
    }

    // Bu bayrak, fotoğraf yüklemesi dâhil TÜM gidiş-dönüş boyunca butonu
    // kilitli tutar: seansta kişi başı e-posta tekilliği yok, çift tıklama iki
    // koltuk ayırıp iki taslak açabilir (bkz. workshop-participant.ts).
    setSubmitting(true);
    try {
      const turnstileToken = (await turnstileRef.current?.getToken()) ?? "";
      const uploadForm = new FormData();
      uploadForm.append("file", photoFile);
      uploadForm.append("turnstileToken", turnstileToken);
      const uploaded = await uploadWithProgress<{ key: string }>(
        "/api/upload",
        uploadForm
      );

      const res = await fetch(`/api/workshop/join/${encodeURIComponent(token)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          fullName: fullName.trim(),
          email: email.trim(),
          phone: phoneE164,
          photoKey: uploaded.key,
          kvkkConsent: consentOk,
          contentConsent: consentOk,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Katılım kaydedilemedi. Lütfen tekrar deneyin.");
        setErrorCode(typeof data.code === "string" ? data.code : null);
        setSubmitting(false);
        return;
      }
      // Tam sayfa geçişi: hedef ödeme akışıdır, bu bileşen bir daha
      // kullanılmayacak — `submitting` bilerek true bırakılır ki geçiş
      // tamamlanana kadar buton tekrar tıklanabilir olmasın.
      window.location.href = data.payUrl;
    } catch (err: unknown) {
      setError(
        err instanceof Error ? err.message : "Bir hata oluştu. Lütfen tekrar deneyin."
      );
      setSubmitting(false);
    }
  };

  return (
    <main className="min-h-screen bg-bg-base">
      <div className="mx-auto max-w-lg px-4 py-12 sm:py-16">
        <p className="text-xs font-medium uppercase tracking-wider text-green-600">
          Figurunica Atölye
        </p>
        <h1 className="font-display text-3xl sm:text-4xl text-text-primary mt-2 mb-8">
          {view.venueName}
        </h1>

        <Card padding="lg">
          <dl className="space-y-4 text-sm">
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-muted">
                Mekan
              </dt>
              <dd className="text-text-primary mt-0.5">
                {view.venueDistrict}, {view.venueCity}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-muted">
                Tarih ve saat
              </dt>
              <dd className="text-text-primary mt-0.5">
                {formatDateTime(view.startsAt)}
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-muted">
                Kalan kontenjan
              </dt>
              <dd className="text-text-primary mt-0.5">
                {remaining} / {view.capacity} kişi
              </dd>
            </div>
            <div>
              <dt className="text-xs uppercase tracking-wide text-text-muted">
                Son katılım tarihi
              </dt>
              <dd className="text-text-primary mt-0.5">
                {formatDeadline(view.joinClosesAt)}
              </dd>
            </div>
          </dl>
        </Card>

        <Card padding="lg" className="mt-6">
          <h2 className="text-lg font-semibold text-text-primary mb-4">
            Katıl
          </h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <FormField label="Ad soyad" required htmlFor={fid("name")}>
                <Input
                  id={fid("name")}
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  maxLength={120}
                  autoComplete="name"
                  disabled={submitting}
                />
              </FormField>
              <FormField label="E-posta" required htmlFor={fid("email")}>
                <Input
                  id={fid("email")}
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  required
                  maxLength={200}
                  autoComplete="email"
                  disabled={submitting}
                />
              </FormField>
              <FormField
                label="Telefon"
                required
                htmlFor={fid("phone")}
                className="sm:col-span-2"
              >
                <PhoneInput
                  id={fid("phone")}
                  required
                  country={phoneCountry}
                  nationalNumber={phone}
                  onCountryChange={setPhoneCountry}
                  onNationalNumberChange={setPhone}
                />
              </FormField>
            </div>

            <FormField
              label="Fotoğraf"
              required
              hint="JPEG veya PNG, en fazla 20 MB."
              error={photoError}
            >
              <label className="block cursor-pointer rounded-xl border border-dashed border-bg-subtle bg-bg-elevated p-4 text-center transition hover:border-green-500/50">
                {/* Kasıtlı olarak `required` YOK: bu input `hidden` (görsel
                    olarak gizli), ve görsel olarak gizli bir alana `required`
                    koymak tarayıcının "unfocusable element" doğrulama hatası
                    fırlatmasına yol açar — submit sessizce hiçbir şey
                    yapmaz. Eksiklik `handleSubmit`'teki `!photoFile` kontrolü
                    ve `photoError` ile JS tarafında karşılanıyor. */}
                <input
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={handlePhotoChange}
                  disabled={submitting}
                />
                {photoPreview ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={photoPreview}
                    alt="Seçilen fotoğraf"
                    className="mx-auto max-h-48 rounded-lg object-contain"
                  />
                ) : (
                  <span className="text-sm text-text-muted">
                    Fotoğraf seçmek için tıklayın
                  </span>
                )}
              </label>
            </FormField>

            <ContentConsent onChange={setConsentOk} />

            {errorCode === "email_registered" ? (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-error"
              >
                Bu e-posta ile kayıtlı bir hesap var.{" "}
                <Link href="/login" className="font-semibold underline">
                  Giriş yapın
                </Link>{" "}
                ve tekrar deneyin.
              </p>
            ) : error ? (
              <p
                role="alert"
                aria-live="assertive"
                className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-error"
              >
                {error}
              </p>
            ) : null}

            <Turnstile ref={turnstileRef} />

            <Button type="submit" loading={submitting} fullWidth size="lg">
              {submitting ? "Kaydediliyor…" : "Katıl ve öde"}
            </Button>
          </form>
        </Card>

        <p className="text-center text-xs text-text-muted mt-8">
          Bu sayfa yalnızca bağlantıyı bilenlere açıktır.
        </p>
      </div>
    </main>
  );
}
