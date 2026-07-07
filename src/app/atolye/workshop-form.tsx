"use client";

import { useState, useRef, useMemo, useId, useEffect } from "react";
import Link from "next/link";
import { Button, Card, Input, Select, Textarea, FormField } from "@/components/ui";
import { PhoneInput, phoneInputToE164 } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, type CountryCode } from "@/lib/phone";
import { Turnstile, type TurnstileRef } from "@/components/turnstile";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";
import {
  WORKSHOP_VENUE_TYPES,
  WORKSHOP_AGE_GROUPS,
  WORKSHOP_TYPES,
} from "@/lib/workshop/constants";

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-sm font-semibold text-text-primary border-b border-bg-subtle pb-2">
      {children}
    </h2>
  );
}

export function WorkshopForm() {
  // Contact
  const [contactName, setContactName] = useState("");
  const [contactEmail, setContactEmail] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState("");
  const [organizationName, setOrganizationName] = useState("");
  // Venue
  const [venueType, setVenueType] = useState("");
  const [city, setCity] = useState("");
  const [district, setDistrict] = useState("");
  const [addressLine, setAddressLine] = useState("");
  // Event
  const [participantCount, setParticipantCount] = useState("");
  const [ageGroup, setAgeGroup] = useState("");
  const [workshopType, setWorkshopType] = useState("");
  const [preferredDate, setPreferredDate] = useState("");
  const [alternativeDate, setAlternativeDate] = useState("");
  const [budgetRange, setBudgetRange] = useState("");
  // Extra
  const [message, setMessage] = useState("");
  const [howHeard, setHowHeard] = useState("");
  const [kvkkConsent, setKvkkConsent] = useState(false);

  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [reference, setReference] = useState<string | null>(null);
  const turnstileRef = useRef<TurnstileRef>(null);
  const successHeadingRef = useRef<HTMLHeadingElement>(null);

  // Stable base id so each label associates with its control (a11y: WCAG 1.3.1/4.1.2).
  const uid = useId();
  const fid = (name: string) => `${uid}-${name}`;

  // Prevent picking a past date for a future event.
  const todayStr = useMemo(() => {
    const d = new Date();
    const pad = (n: number) => String(n).padStart(2, "0");
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  }, []);

  const districtOptions = useMemo(
    () => (city ? DISTRICTS[city] ?? [] : []),
    [city]
  );

  // Move focus to the success heading so screen-reader users are told it worked.
  useEffect(() => {
    if (reference !== null) successHeadingRef.current?.focus();
  }, [reference]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);

    const phoneE164 = phoneInputToE164(phoneCountry, phone);
    if (!phoneE164) {
      setError("Geçerli bir telefon numarası girin.");
      return;
    }
    if (!kvkkConsent) {
      setError("Devam etmek için KVKK aydınlatma metnini onaylayın.");
      return;
    }

    setLoading(true);
    try {
      const token = (await turnstileRef.current?.getToken()) ?? "";
      const res = await fetch("/api/workshop-requests", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactName,
          contactEmail,
          contactPhone: phoneE164,
          organizationName,
          venueType,
          city,
          district,
          addressLine,
          participantCount: Number(participantCount),
          ageGroup,
          workshopType,
          preferredDate,
          alternativeDate,
          budgetRange,
          message,
          howHeard,
          kvkkConsent,
          turnstileToken: token,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(data.error || "Talep gönderilemedi. Lütfen tekrar deneyin.");
        return;
      }
      setReference(data.reference ?? "");
      window.scrollTo({ top: 0, behavior: "smooth" });
    } catch {
      setError("Bir hata oluştu. Lütfen tekrar deneyin.");
    } finally {
      setLoading(false);
    }
  };

  // ─── Success ──────────────────────────────────────────────────────────────
  if (reference !== null) {
    return (
      <Card padding="lg" elevated className="text-center" role="status" aria-live="polite">
        <div className="mx-auto mb-4 flex h-14 w-14 items-center justify-center rounded-full bg-green-500/10 text-green-500">
          <svg className="h-7 w-7" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
          </svg>
        </div>
        <h2
          ref={successHeadingRef}
          tabIndex={-1}
          className="font-display text-2xl text-text-primary mb-2 outline-none"
        >
          Talebiniz alındı!
        </h2>
        <p className="text-text-secondary mb-5">
          En kısa sürede sizinle iletişime geçeceğiz. Onay e-postanızı gönderdik.
        </p>
        {reference && (
          <div className="inline-block rounded-xl bg-bg-subtle px-6 py-4">
            <p className="text-xs text-text-muted">Talep referansınız</p>
            <p className="mt-1 font-mono text-xl font-bold tracking-wider text-text-primary">
              {reference}
            </p>
          </div>
        )}
        <div className="mt-6">
          <Button href="/" variant="secondary" size="sm">
            Ana sayfaya dön
          </Button>
        </div>
      </Card>
    );
  }

  // ─── Form ─────────────────────────────────────────────────────────────────
  return (
    <Card padding="lg" elevated>
      <form onSubmit={handleSubmit} className="space-y-8">
        {/* İletişim */}
        <div className="space-y-4">
          <SectionTitle>İletişim bilgileri</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Ad soyad" required htmlFor={fid("name")}>
              <Input
                id={fid("name")}
                value={contactName}
                onChange={(e) => setContactName(e.target.value)}
                required
                maxLength={120}
                autoComplete="name"
              />
            </FormField>
            <FormField label="E-posta" required htmlFor={fid("email")}>
              <Input
                id={fid("email")}
                type="email"
                value={contactEmail}
                onChange={(e) => setContactEmail(e.target.value)}
                required
                maxLength={160}
                autoComplete="email"
              />
            </FormField>
            <FormField label="Telefon" required htmlFor={fid("phone")}>
              <PhoneInput
                id={fid("phone")}
                required
                country={phoneCountry}
                nationalNumber={phone}
                onCountryChange={setPhoneCountry}
                onNationalNumberChange={setPhone}
              />
            </FormField>
            <FormField label="Kurum / İşletme" hint="Varsa" htmlFor={fid("org")}>
              <Input
                id={fid("org")}
                value={organizationName}
                onChange={(e) => setOrganizationName(e.target.value)}
                maxLength={160}
                autoComplete="organization"
              />
            </FormField>
          </div>
        </div>

        {/* Mekân */}
        <div className="space-y-4">
          <SectionTitle>Mekân</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Mekân türü" required htmlFor={fid("venueType")}>
              <Select
                id={fid("venueType")}
                value={venueType}
                onChange={(e) => setVenueType(e.target.value)}
                required
              >
                <option value="">Seçin</option>
                {WORKSHOP_VENUE_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <div className="hidden sm:block" />
            <FormField label="İl" required htmlFor={fid("city")}>
              <Select
                id={fid("city")}
                value={city}
                onChange={(e) => {
                  setCity(e.target.value);
                  setDistrict("");
                }}
                required
              >
                <option value="">Seçin</option>
                {PROVINCES.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="İlçe" required htmlFor={fid("district")}>
              <Select
                id={fid("district")}
                value={district}
                onChange={(e) => setDistrict(e.target.value)}
                required
                disabled={!city}
              >
                <option value="">Seçin</option>
                {districtOptions.map((dist) => (
                  <option key={dist} value={dist}>
                    {dist}
                  </option>
                ))}
              </Select>
            </FormField>
          </div>
          <FormField label="Açık adres" required htmlFor={fid("address")}>
            <Textarea
              id={fid("address")}
              value={addressLine}
              onChange={(e) => setAddressLine(e.target.value)}
              required
              rows={2}
              maxLength={500}
              placeholder="Mahalle, cadde, no, kat vb."
            />
          </FormField>
        </div>

        {/* Etkinlik */}
        <div className="space-y-4">
          <SectionTitle>Etkinlik detayları</SectionTitle>
          <div className="grid gap-4 sm:grid-cols-2">
            <FormField label="Katılımcı sayısı" required htmlFor={fid("participants")}>
              <Input
                id={fid("participants")}
                type="number"
                min={1}
                max={1000}
                value={participantCount}
                onChange={(e) => setParticipantCount(e.target.value)}
                required
              />
            </FormField>
            <FormField label="Yaş grubu" required htmlFor={fid("ageGroup")}>
              <Select
                id={fid("ageGroup")}
                value={ageGroup}
                onChange={(e) => setAgeGroup(e.target.value)}
                required
              >
                <option value="">Seçin</option>
                {WORKSHOP_AGE_GROUPS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Etkinlik türü" required htmlFor={fid("workshopType")}>
              <Select
                id={fid("workshopType")}
                value={workshopType}
                onChange={(e) => setWorkshopType(e.target.value)}
                required
              >
                <option value="">Seçin</option>
                {WORKSHOP_TYPES.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </Select>
            </FormField>
            <FormField label="Bütçe" hint="Opsiyonel" htmlFor={fid("budget")}>
              <Input
                id={fid("budget")}
                value={budgetRange}
                onChange={(e) => setBudgetRange(e.target.value)}
                maxLength={80}
                placeholder="örn. kişi başı ₺500"
              />
            </FormField>
            <FormField label="Tercih edilen tarih" hint="Opsiyonel" htmlFor={fid("prefDate")}>
              <Input
                id={fid("prefDate")}
                type="date"
                min={todayStr}
                value={preferredDate}
                onChange={(e) => setPreferredDate(e.target.value)}
              />
            </FormField>
            <FormField label="Alternatif tarih" hint="Opsiyonel" htmlFor={fid("altDate")}>
              <Input
                id={fid("altDate")}
                type="date"
                min={todayStr}
                value={alternativeDate}
                onChange={(e) => setAlternativeDate(e.target.value)}
              />
            </FormField>
          </div>
        </div>

        {/* Ek bilgiler */}
        <div className="space-y-4">
          <SectionTitle>Ek bilgiler</SectionTitle>
          <FormField label="Eklemek istedikleriniz" hint="Opsiyonel" htmlFor={fid("message")}>
            <Textarea
              id={fid("message")}
              value={message}
              onChange={(e) => setMessage(e.target.value)}
              rows={4}
              maxLength={2000}
              placeholder="Etkinliğinizle ilgili beklentileriniz, özel istekler…"
            />
          </FormField>
          <FormField label="Bizi nereden duydunuz?" hint="Opsiyonel" htmlFor={fid("howHeard")}>
            <Input
              id={fid("howHeard")}
              value={howHeard}
              onChange={(e) => setHowHeard(e.target.value)}
              maxLength={160}
              placeholder="Instagram, tavsiye, arama…"
            />
          </FormField>
        </div>

        {/* KVKK + gönder */}
        <div className="space-y-4">
          <label className="flex items-start gap-2.5 text-sm text-text-secondary">
            <input
              type="checkbox"
              checked={kvkkConsent}
              onChange={(e) => setKvkkConsent(e.target.checked)}
              className="mt-0.5 h-4 w-4 rounded"
              required
            />
            <span>
              Kişisel verilerimin bu talep kapsamında işlenmesine yönelik{" "}
              <Link
                href="/privacy"
                target="_blank"
                className="text-green-500 underline hover:text-green-400"
              >
                KVKK Aydınlatma Metni
              </Link>
              ni okudum ve onaylıyorum.
            </span>
          </label>

          {error && (
            <div
              role="alert"
              aria-live="assertive"
              className="rounded-xl bg-red-500/10 px-4 py-3 text-sm text-error"
            >
              {error}
            </div>
          )}

          <Turnstile ref={turnstileRef} />

          <Button type="submit" loading={loading} fullWidth size="lg">
            {loading ? "Gönderiliyor…" : "Talep gönder"}
          </Button>
          <p className="text-center text-xs text-text-muted">
            Formu göndererek talebiniz ekibimize ulaşır; bağlayıcı bir sipariş
            oluşturmaz.
          </p>
        </div>
      </form>
    </Card>
  );
}
