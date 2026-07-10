"use client";

import { useState, useEffect, useMemo } from "react";
import { PROVINCES, DISTRICTS } from "@/lib/data/turkey-address";
import { ManufacturerKyc } from "@/components/manufacturer-kyc";
import { PhoneInput, phoneInputToE164, e164ToPhoneInput } from "@/components/PhoneInput";
import { DEFAULT_COUNTRY, formatPhoneDisplay, type CountryCode } from "@/lib/phone";

interface TurkishAddress {
  adres: string;
  mahalle?: string;
  ilce: string;
  il: string;
  postaKodu: string;
  telefon: string;
}

interface ManufacturerProfile {
  id: string;
  email: string;
  companyName: string;
  contactPerson: string;
  phone: string;
  whatsappPhone: string | null;
  address: TurkishAddress | null;
  taxId: string | null;
  taxIdType: "vkn" | "tckn" | null;
  requiresManualTaxReview: boolean;
  iban: string | null;
  bankAccountHolder: string | null;
  bankName: string | null;
  maxConcurrentOrders: number;
  acceptingOrders: boolean;
  paintsInHouse: boolean;
  capabilities: string[] | null;
  status: string;
  createdAt: string;
}

function formatTaxId(taxId: string, taxIdType: "vkn" | "tckn"): string {
  if (taxIdType === "vkn") return `VKN: ${taxId}`;
  return `TCKN: ${taxId.slice(0, 5)}****${taxId.slice(-2)}`;
}

const STATUS_LABELS: Record<string, { label: string; color: string }> = {
  pending_approval: { label: "Beklemede", color: "bg-amber-100 text-amber-700" },
  active: { label: "Aktif", color: "bg-emerald-100 text-emerald-700" },
  suspended: { label: "Askıya Alınmış", color: "bg-red-100 text-red-700" },
};

// Production materials. Stored on `capabilities` as `material_<key>` tags.
const MATERIAL_OPTIONS = [
  { key: "resin", label: "Reçine (Resin)", desc: "Yüksek detay, premium yüzey" },
  { key: "filament", label: "Filament (FDM)", desc: "Ekonomik, dayanıklı baskı" },
];
const MATERIAL_LABELS: Record<string, string> = {
  resin: "Reçine (Resin)",
  filament: "Filament (FDM)",
};

export default function ManufacturerProfilePage() {
  const [profile, setProfile] = useState<ManufacturerProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  // Editable form state
  const [contactPerson, setContactPerson] = useState("");
  const [phoneCountry, setPhoneCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [phone, setPhone] = useState("");
  const [waCountry, setWaCountry] = useState<CountryCode>(DEFAULT_COUNTRY);
  const [whatsappPhone, setWhatsappPhone] = useState("");
  const [il, setIl] = useState("");
  const [ilce, setIlce] = useState("");
  const [mahalle, setMahalle] = useState("");
  const [postaKodu, setPostaKodu] = useState("");
  const [adres, setAdres] = useState("");
  const [iban, setIban] = useState("");
  const [bankAccountHolder, setBankAccountHolder] = useState("");
  const [bankName, setBankName] = useState("");
  const [maxConcurrent, setMaxConcurrent] = useState(5);
  const [acceptingOrders, setAcceptingOrders] = useState(true);
  const [paintsInHouse, setPaintsInHouse] = useState(false);
  const [materials, setMaterials] = useState<string[]>([]);
  const toggleMaterial = (key: string) =>
    setMaterials((prev) =>
      prev.includes(key) ? prev.filter((m) => m !== key) : [...prev, key]
    );

  const districtOptions = useMemo(() => (il ? DISTRICTS[il] ?? [] : []), [il]);

  const loadProfile = async () => {
    try {
      const res = await fetch("/api/manufacturer/auth/me");
      if (!res.ok) {
        setError("Profil yüklenemedi");
        return;
      }
      const data = await res.json();
      const p: ManufacturerProfile = data.manufacturer;
      setProfile(p);
      setContactPerson(p.contactPerson);
      const phoneSeed = e164ToPhoneInput(p.phone);
      setPhoneCountry(phoneSeed.country);
      setPhone(phoneSeed.nationalNumber);
      const waSeed = e164ToPhoneInput(p.whatsappPhone);
      setWaCountry(waSeed.country);
      setWhatsappPhone(waSeed.nationalNumber);
      setIl(p.address?.il ?? "");
      setIlce(p.address?.ilce ?? "");
      setMahalle(p.address?.mahalle ?? "");
      setPostaKodu(p.address?.postaKodu ?? "");
      setAdres(p.address?.adres ?? "");
      setIban(p.iban ?? "");
      setBankAccountHolder(p.bankAccountHolder ?? "");
      setBankName(p.bankName ?? "");
      setMaxConcurrent(p.maxConcurrentOrders);
      setAcceptingOrders(p.acceptingOrders);
      setPaintsInHouse(p.paintsInHouse);
      // Derive declared materials from capability tags. A legacy manufacturer
      // with none declared accepts all — pre-check both so editing preserves
      // that (saving an empty set would fail the server's min-1 rule).
      const declared = (p.capabilities ?? [])
        .filter((c) => c.startsWith("material_"))
        .map((c) => c.replace("material_", ""));
      setMaterials(declared.length > 0 ? declared : ["resin", "filament"]);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadProfile();
  }, []);

  const handleSave = async () => {
    const phoneE164 = phoneInputToE164(phoneCountry, phone);
    if (!phoneE164) {
      setSaveError("Geçerli bir telefon numarası girin");
      return;
    }
    let whatsappE164: string | null = null;
    if (whatsappPhone.trim()) {
      whatsappE164 = phoneInputToE164(waCountry, whatsappPhone);
      if (!whatsappE164) {
        setSaveError("Geçerli bir WhatsApp numarası girin");
        return;
      }
    }
    setSaving(true);
    setSaveError(null);
    try {
      const ibanClean = iban.replace(/\s+/g, "").toUpperCase();
      const res = await fetch("/api/manufacturer/auth/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contactPerson,
          phone: phoneE164,
          whatsappPhone: whatsappE164,
          address: {
            adres,
            mahalle: mahalle || undefined,
            ilce,
            il,
            postaKodu,
            telefon: phoneE164,
          },
          iban: ibanClean,
          bankAccountHolder,
          bankName,
          maxConcurrentOrders: Number(maxConcurrent),
          acceptingOrders,
          paintsInHouse,
          materials,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setSaveError(data.error || "Kaydedilemedi");
        return;
      }
      setEditing(false);
      await loadProfile();
    } catch {
      setSaveError("Bir hata oluştu");
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div className="p-4 sm:p-8 flex items-center justify-center min-h-[50vh]">
        <div className="animate-spin w-10 h-10 border-4 border-indigo-500 border-t-transparent rounded-full" />
      </div>
    );
  }

  if (error || !profile) {
    return (
      <div className="p-4 sm:p-8">
        <div className="bg-red-50 text-red-700 rounded-xl p-4 text-sm">{error}</div>
      </div>
    );
  }

  const statusInfo = STATUS_LABELS[profile.status] ?? {
    label: profile.status,
    color: "bg-gray-100 text-gray-700",
  };
  const declaredMaterials = (profile.capabilities ?? [])
    .filter((c) => c.startsWith("material_"))
    .map((c) => c.replace("material_", ""));
  const inputCls =
    "w-full px-3 py-2 border border-gray-200 rounded-xl bg-white text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500";

  return (
    <div className="p-4 sm:p-8 max-w-3xl">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Profil</h1>
          <p className="text-gray-500 mt-1 text-sm">Hesap bilgilerinizi güncelleyin.</p>
        </div>
        <span className={`px-3 py-1 rounded-full text-xs font-medium ${statusInfo.color}`}>
          {statusInfo.label}
        </span>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 p-6 space-y-6">
        {/* Read-only identifiers */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 pb-4 border-b border-gray-100">
          <div>
            <p className="text-xs font-medium text-gray-500">Firma</p>
            <p className="text-gray-900 font-medium">{profile.companyName}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">E-posta</p>
            <p className="text-gray-900">{profile.email}</p>
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">Vergi No.</p>
            {profile.taxId && profile.taxIdType ? (
              <p className="text-gray-900 font-mono text-sm">{formatTaxId(profile.taxId, profile.taxIdType)}</p>
            ) : (
              <p className="text-amber-700 text-sm">Manuel inceleme — admin@figurunica.com</p>
            )}
          </div>
          <div>
            <p className="text-xs font-medium text-gray-500">Üyelik</p>
            <p className="text-gray-900 text-sm">{new Date(profile.createdAt).toLocaleDateString("tr-TR")}</p>
          </div>
        </div>

        {/* Editable form */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Yetkili Kişi</label>
            {editing ? (
              <input className={inputCls} value={contactPerson} onChange={(e) => setContactPerson(e.target.value)} />
            ) : (
              <p className="text-gray-900">{profile.contactPerson}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Telefon</label>
            {editing ? (
              <PhoneInput
                required
                country={phoneCountry}
                nationalNumber={phone}
                onCountryChange={setPhoneCountry}
                onNationalNumberChange={setPhone}
              />
            ) : (
              <p className="text-gray-900">{profile.phone ? formatPhoneDisplay(profile.phone) : "—"}</p>
            )}
          </div>
          <div className="sm:col-span-2">
            <label className="block text-xs font-medium text-gray-500 mb-1">WhatsApp (opsiyonel)</label>
            {editing ? (
              <PhoneInput
                country={waCountry}
                nationalNumber={whatsappPhone}
                onCountryChange={setWaCountry}
                onNationalNumberChange={setWhatsappPhone}
              />
            ) : (
              <p className="text-gray-900">{profile.whatsappPhone ?? "—"}</p>
            )}
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Adres</h3>
          {editing ? (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <select className={inputCls} value={il} onChange={(e) => { setIl(e.target.value); setIlce(""); }}>
                <option value="">İl seçiniz</option>
                {PROVINCES.map((p) => <option key={p} value={p}>{p}</option>)}
              </select>
              <select className={inputCls} value={ilce} onChange={(e) => setIlce(e.target.value)} disabled={!il}>
                <option value="">İlçe seçiniz</option>
                {districtOptions.map((dist) => <option key={dist} value={dist}>{dist}</option>)}
              </select>
              <input className={inputCls} placeholder="Mahalle" value={mahalle} onChange={(e) => setMahalle(e.target.value)} />
              <input className={inputCls} placeholder="Posta Kodu" value={postaKodu} onChange={(e) => setPostaKodu(e.target.value)} />
              <textarea className={`${inputCls} sm:col-span-2`} rows={2} placeholder="Açık Adres" value={adres} onChange={(e) => setAdres(e.target.value)} />
            </div>
          ) : profile.address ? (
            <p className="text-gray-900 text-sm whitespace-pre-line">
              {profile.address.adres}
              {profile.address.mahalle ? `\n${profile.address.mahalle}` : ""}
              {`\n${profile.address.ilce} / ${profile.address.il} ${profile.address.postaKodu}`}
            </p>
          ) : (
            <p className="text-amber-700 text-sm">Adres bilgisi yok — düzenleyip kaydediniz.</p>
          )}
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Banka</h3>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="sm:col-span-2">
              <label className="block text-xs font-medium text-gray-500 mb-1">IBAN</label>
              {editing ? (
                <input className={`${inputCls} font-mono uppercase`} value={iban} onChange={(e) => setIban(e.target.value.toUpperCase())} />
              ) : (
                <p className="text-gray-900 font-mono text-sm">{profile.iban ?? "—"}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Hesap Sahibi</label>
              {editing ? (
                <input className={inputCls} value={bankAccountHolder} onChange={(e) => setBankAccountHolder(e.target.value)} />
              ) : (
                <p className="text-gray-900 text-sm">{profile.bankAccountHolder ?? "—"}</p>
              )}
            </div>
            <div>
              <label className="block text-xs font-medium text-gray-500 mb-1">Banka</label>
              {editing ? (
                <input className={inputCls} value={bankName} onChange={(e) => setBankName(e.target.value)} />
              ) : (
                <p className="text-gray-900 text-sm">{profile.bankName ?? "—"}</p>
              )}
            </div>
          </div>
        </div>

        <div>
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide mb-3">Üretim Malzemeleri</h3>
          {editing ? (
            <>
              <p className="text-xs text-gray-500 mb-2">
                Basabildiğiniz malzemeler. Siparişler yalnızca uygun malzemeyi
                basabilen üreticilere atanır. (En az bir seçim)
              </p>
              <div className="flex flex-wrap gap-2">
                {MATERIAL_OPTIONS.map((m) => {
                  const active = materials.includes(m.key);
                  return (
                    <button
                      key={m.key}
                      type="button"
                      onClick={() => toggleMaterial(m.key)}
                      className={`flex-1 min-w-[160px] text-left rounded-xl border p-3 transition ${
                        active
                          ? "border-indigo-500 bg-indigo-50"
                          : "border-gray-200 bg-white hover:border-indigo-300"
                      }`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <span className="text-sm font-medium text-gray-900">{m.label}</span>
                        <span
                          className={`h-4 w-4 rounded border flex items-center justify-center shrink-0 ${
                            active ? "bg-indigo-600 border-indigo-600" : "border-gray-300"
                          }`}
                        >
                          {active && (
                            <svg className="w-3 h-3 text-white" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={3} d="M5 13l4 4L19 7" />
                            </svg>
                          )}
                        </span>
                      </div>
                      <p className="text-xs text-gray-500 mt-0.5">{m.desc}</p>
                    </button>
                  );
                })}
              </div>
            </>
          ) : declaredMaterials.length > 0 ? (
            <div className="flex flex-wrap gap-2">
              {declaredMaterials.map((m) => (
                <span key={m} className="px-3 py-1 rounded-full text-xs font-medium bg-indigo-50 text-indigo-700">
                  {MATERIAL_LABELS[m] ?? m}
                </span>
              ))}
            </div>
          ) : (
            <p className="text-gray-500 text-sm">Tüm malzemeler (beyan edilmemiş)</p>
          )}
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Maksimum eş zamanlı sipariş</label>
            {editing ? (
              <input type="number" min={1} max={50} className={`${inputCls} max-w-[140px]`} value={maxConcurrent} onChange={(e) => setMaxConcurrent(Number(e.target.value) || 1)} />
            ) : (
              <p className="text-gray-900 text-sm">{profile.maxConcurrentOrders}</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Sipariş Alıyor</label>
            {editing ? (
              <label className="inline-flex items-center gap-2 mt-1 text-sm text-gray-700">
                <input type="checkbox" checked={acceptingOrders} onChange={(e) => setAcceptingOrders(e.target.checked)} className="h-4 w-4 rounded" />
                Yeni sipariş atamaları kabul ediliyor
              </label>
            ) : (
              <p className={`text-sm font-medium ${profile.acceptingOrders ? "text-emerald-700" : "text-red-700"}`}>
                {profile.acceptingOrders ? "Evet" : "Hayır (atamalar durduruldu)"}
              </p>
            )}
          </div>
          <div>
            <label className="block text-xs font-medium text-gray-500 mb-1">Kendi Boyama</label>
            {editing ? (
              <label className="inline-flex items-center gap-2 mt-1 text-sm text-gray-700">
                <input type="checkbox" checked={paintsInHouse} onChange={(e) => setPaintsInHouse(e.target.checked)} className="h-4 w-4 rounded" />
                Boyamalı siparişleri kendim boyayıp kargolarım
              </label>
            ) : (
              <p className={`text-sm font-medium ${profile.paintsInHouse ? "text-emerald-700" : "text-gray-600"}`}>
                {profile.paintsInHouse ? "Evet (boyayıp kargolarım)" : "Hayır (boyacıya gönderilir)"}
              </p>
            )}
          </div>
        </div>

        {saveError && (
          <div className="bg-red-50 text-red-700 rounded-xl p-3 text-sm">{saveError}</div>
        )}

        <div className="flex items-center justify-end gap-2 pt-2 border-t border-gray-100">
          {editing ? (
            <>
              <button
                type="button"
                onClick={() => { setEditing(false); void loadProfile(); }}
                className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800"
              >
                İptal
              </button>
              <button
                type="button"
                disabled={saving}
                onClick={handleSave}
                className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium disabled:bg-indigo-400"
              >
                {saving ? "Kaydediliyor..." : "Kaydet"}
              </button>
            </>
          ) : (
            <button
              type="button"
              onClick={() => setEditing(true)}
              className="px-5 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium"
            >
              Düzenle
            </button>
          )}
        </div>
      </div>

      <PrinterPhotosSection />

      <ManufacturerKyc />
    </div>
  );
}

// Printer photos: a manufacturer may run several printers, so multiple photos
// are supported — this section lists the verification photos on file and lets
// an approved manufacturer add more (photos are verification documents, so
// there is no delete).
function PrinterPhotosSection() {
  const [photos, setPhotos] = useState<{ id: string; url: string; createdAt: string }[]>([]);
  const [photosLoading, setPhotosLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [uploadError, setUploadError] = useState<string | null>(null);

  const loadPhotos = async () => {
    try {
      const res = await fetch("/api/manufacturer/printer-photo");
      if (res.ok) {
        const data = await res.json();
        setPhotos(data.photos ?? []);
      }
    } finally {
      setPhotosLoading(false);
    }
  };

  useEffect(() => {
    void loadPhotos();
  }, []);

  const handleUpload = async (files: FileList) => {
    setUploadError(null);
    setUploading(true);
    try {
      const fd = new FormData();
      for (const file of Array.from(files)) fd.append("file", file);
      const res = await fetch("/api/manufacturer/printer-photo", { method: "POST", body: fd });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        setUploadError(data.error || "Yükleme başarısız");
        return;
      }
      await loadPhotos();
    } catch {
      setUploadError("Bir hata oluştu");
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="bg-white rounded-xl border border-gray-200 p-6 mt-6">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h3 className="text-xs font-semibold text-gray-700 uppercase tracking-wide">
            Yazıcı Fotoğrafları
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            Birden çok yazıcınız varsa her biri için ayrı fotoğraf ekleyebilirsiniz.
            Fotoğraflar doğrulama belgesidir; silinemez.
          </p>
        </div>
        <label className="inline-block px-4 py-2 bg-indigo-600 text-white rounded-xl text-sm font-medium cursor-pointer hover:bg-indigo-700">
          {uploading ? "Yükleniyor..." : "Fotoğraf ekle"}
          <input
            type="file"
            accept="image/jpeg,image/png"
            multiple
            className="hidden"
            disabled={uploading}
            onChange={(e) => e.target.files?.length && handleUpload(e.target.files)}
          />
        </label>
      </div>
      {uploadError && (
        <p className="mt-3 text-sm text-red-600">{uploadError}</p>
      )}
      {photosLoading ? (
        <p className="mt-4 text-sm text-gray-400">Yükleniyor…</p>
      ) : photos.length === 0 ? (
        <p className="mt-4 text-sm text-gray-400">Henüz yazıcı fotoğrafı yüklenmedi.</p>
      ) : (
        <div className="mt-4 grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3">
          {photos.map((p) => (
            <a
              key={p.id}
              href={p.url}
              target="_blank"
              rel="noopener noreferrer"
              className="block aspect-square overflow-hidden rounded-xl border border-gray-200 hover:ring-2 hover:ring-indigo-300"
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={p.url} alt="Yazıcı fotoğrafı" className="h-full w-full object-cover" />
            </a>
          ))}
        </div>
      )}
    </div>
  );
}
