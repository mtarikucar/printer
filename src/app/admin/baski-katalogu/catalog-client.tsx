"use client";

import { useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { dfmMessage } from "@/components/quote/dfm-list";
import { useDictionary } from "@/lib/i18n/locale-context";
import { LEAD_TIER_KEYS } from "@/lib/config/quote-types";
import type { DfmIssue, LeadTierKey } from "@/lib/config/quote-types";
import type {
  AdminAddon,
  AdminCatalogChange,
  AdminFinish,
  AdminMaterial,
  AdminPricingSettings,
  AdminTechnology,
  QuoteSimulationResult,
} from "@/lib/services/quote-catalog-admin";
import { CATALOG_LIMITS } from "@/lib/validators/print-catalog";
import {
  ADDON_FIELDS,
  EMPTY_PROPERTIES_DRAFT,
  FINISH_FIELDS,
  KEY_FIELD,
  MATERIAL_FIELDS,
  TECHNOLOGY_FIELDS,
  numberOf,
  tl,
  toDraft,
  toIntList,
  toKurus,
  toPayload,
} from "./form-values";
import type { ColorDraft, Draft, DraftValue, Field, PropertiesDraft } from "./form-values";

/**
 * Baskı kataloğunun düzenleyicisi.
 *
 * Formlar ALAN TANIMINDAN üretilir (tek `<EntityEditor>`), çünkü dört varlık
 * için dört el yazması form, ilk alan eklendiğinde üç yerde unutulan bir alan
 * demekti. Sınır ipuçları `CATALOG_LIMITS`ten okunur: ekranın "girilebilir"
 * dediği değeri sunucunun reddetmesi, sahibin güvenini yiyen türden bir
 * tutarsızlıktır.
 *
 * Para alanları ekranda ₺ (iki ondalık), sunucuya KURUŞ gider; oran alanları
 * ekranda yüzde/çarpan, sunucuya BAZ PUAN. Yönetici baz puan düşünmek zorunda
 * kalmamalı — ama tabloda duran şey baz puandır.
 *
 * Alan tanımları ve taslak ⇄ gövde dönüşümü `./form-values.ts`te, SAF hâlde
 * durur: o üç satır doğrudan para yazıyor ve bir ekranın içinde regresyon ağı
 * kurulamıyordu (`scripts/test-quote-admin-catalog.ts` §4 artık oradan okuyor).
 * Girdiler HAM METİN taşır; sayıya çevrim yalnız kaydetme anındadır.
 */

type Iso<T> = Omit<T, "createdAt" | "updatedAt"> & { createdAt: string; updatedAt: string };

export type TechnologyRow = Iso<AdminTechnology>;
export type MaterialRow = Iso<AdminMaterial>;
export type FinishRow = Iso<AdminFinish>;
export type AddonRow = Iso<AdminAddon>;
export type SettingsRow = Omit<AdminPricingSettings, "updatedAt"> & { updatedAt: string };
export type ChangeRow = Omit<AdminCatalogChange, "createdAt"> & { createdAt: string };

type EntityName = "technology" | "material" | "finish" | "addon";

/**
 * Baz puan paydası. Sayı değil ADI kullanılır: depo genelinde `/ 10000`
 * taranıyor (komisyon matematiğinin elle kopyalanmasına karşı,
 * `scripts/test-cost-lines.ts` grep kapısı) ve buradaki çevrimin oranla değil
 * BİRİMLE ilgisi var — ekranda çarpan (×1,4), tabloda baz puan (14000).
 */
const BPS_SCALE = 10_000;

const trField = (n: number, digits = 2) =>
  n.toLocaleString("tr-TR", { minimumFractionDigits: 0, maximumFractionDigits: digits });
const kurusTr = (kurus: number) =>
  `${(kurus / 100).toLocaleString("tr-TR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })} ₺`;

// ─── Uçlar (sözleşme testi için birebir yazılı adresler) ────────────────────

const JSON_HEADERS = { "Content-Type": "application/json" };

async function createRow(entity: EntityName, body: unknown): Promise<Response> {
  const payload = JSON.stringify(body);
  switch (entity) {
    case "technology":
      return fetch("/api/admin/print-catalog/technologies", {
        method: "POST",
        headers: JSON_HEADERS,
        body: payload,
      });
    case "material":
      return fetch("/api/admin/print-catalog/materials", {
        method: "POST",
        headers: JSON_HEADERS,
        body: payload,
      });
    case "finish":
      return fetch("/api/admin/print-catalog/finishes", {
        method: "POST",
        headers: JSON_HEADERS,
        body: payload,
      });
    case "addon":
      return fetch("/api/admin/print-catalog/addons", {
        method: "POST",
        headers: JSON_HEADERS,
        body: payload,
      });
  }
}

async function patchRow(entity: EntityName, id: string, body: unknown): Promise<Response> {
  const payload = JSON.stringify(body);
  switch (entity) {
    case "technology":
      return fetch(`/api/admin/print-catalog/technologies/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: payload,
      });
    case "material":
      return fetch(`/api/admin/print-catalog/materials/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: payload,
      });
    case "finish":
      return fetch(`/api/admin/print-catalog/finishes/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: payload,
      });
    case "addon":
      return fetch(`/api/admin/print-catalog/addons/${id}`, {
        method: "PATCH",
        headers: JSON_HEADERS,
        body: payload,
      });
  }
}

async function readError(response: Response): Promise<string | null> {
  if (response.ok) return null;
  const body = (await response.json().catch(() => ({}))) as { error?: string };
  return body.error ?? `İşlem tamamlanamadı (HTTP ${response.status}).`;
}

// ─── Ortak girdi bileşenleri ────────────────────────────────────────────────

const INPUT_CLASS =
  "rounded border border-gray-300 px-2 py-1 text-sm text-gray-900 focus:border-gray-500 focus:outline-none";

function FieldInput({
  field,
  value,
  onChange,
}: {
  field: Field;
  value: DraftValue;
  onChange: (next: DraftValue) => void;
}) {
  if (field.kind === "bool") {
    return (
      <label className="flex items-center gap-2 text-sm text-gray-800">
        <input
          type="checkbox"
          checked={Boolean(value)}
          onChange={(e) => onChange(e.target.checked)}
          className="h-4 w-4"
        />
        {field.label}
      </label>
    );
  }

  const text = typeof value === "string" ? value : "";
  return (
    <label className={`flex flex-col gap-1 ${field.wide ? "sm:col-span-2" : ""}`}>
      <span className="text-xs font-medium text-gray-600">{field.label}</span>
      {field.kind === "textarea" ? (
        <textarea
          rows={2}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} w-full`}
        />
      ) : field.kind === "select" ? (
        <select
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} w-full`}
        >
          {field.nullable && <option value="">— seçilmedi —</option>}
          {(field.options ?? []).map((o) => (
            <option key={o.value} value={o.value}>
              {o.label}
            </option>
          ))}
        </select>
      ) : (
        <input
          type="text"
          inputMode={field.kind === "text" || field.kind === "intList" ? "text" : "decimal"}
          value={text}
          onChange={(e) => onChange(e.target.value)}
          className={`${INPUT_CLASS} w-full`}
        />
      )}
      {field.hint && <span className="text-[11px] text-gray-500">{field.hint}</span>}
    </label>
  );
}

/**
 * Renk satırları. Ek ücret HAM METİN olarak tutulur: her tuşta kuruşa çevirip
 * iki ondalıkla geri yazmak, "7" + "." yazan yöneticiye "7..00" → `NaN`
 * gösteriyor ve imleci kaydırıyordu. Kuruşa çevrim yalnız kaydetme anında
 * (`toPayload`) yapılır.
 */
function ColorsEditor({
  value,
  onChange,
}: {
  value: ColorDraft[];
  onChange: (next: ColorDraft[]) => void;
}) {
  const set = (i: number, patch: Partial<ColorDraft>) =>
    onChange(value.map((c, j) => (j === i ? { ...c, ...patch } : c)));

  return (
    <div className="sm:col-span-2">
      <p className="text-xs font-medium text-gray-600">Renkler</p>
      <p className="text-[11px] text-gray-500">
        En az bir renk zorunlu. Ek ücret, birim fiyata renk kalemi olarak eklenir.
      </p>
      <div className="mt-2 space-y-2">
        {value.map((color, i) => (
          <div key={i} className="flex flex-wrap items-center gap-2">
            <input
              type="text"
              value={color.key}
              onChange={(e) => set(i, { key: e.target.value })}
              placeholder="anahtar"
              className={`${INPUT_CLASS} w-28`}
            />
            <input
              type="text"
              value={color.name}
              onChange={(e) => set(i, { name: e.target.value })}
              placeholder="Ad"
              className={`${INPUT_CLASS} w-32`}
            />
            <input
              type="text"
              value={color.hex}
              onChange={(e) => set(i, { hex: e.target.value })}
              placeholder="#1A1A1A"
              className={`${INPUT_CLASS} w-28 font-mono`}
            />
            <span
              className="h-6 w-6 shrink-0 rounded border border-gray-300"
              style={{ backgroundColor: /^#[0-9A-Fa-f]{6}$/.test(color.hex) ? color.hex : undefined }}
            />
            <input
              type="text"
              inputMode="decimal"
              value={color.surcharge}
              onChange={(e) => set(i, { surcharge: e.target.value })}
              className={`${INPUT_CLASS} w-24`}
            />
            <span className="text-xs text-gray-500">₺ ek ücret</span>
            <button
              type="button"
              onClick={() => onChange(value.filter((_, j) => j !== i))}
              className="ml-auto text-xs text-gray-400 hover:text-red-600"
            >
              Kaldır
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            onChange([...value, { key: "", name: "", hex: "#000000", surcharge: "0" }])
          }
          className="text-sm font-medium text-green-700 hover:text-green-800"
        >
          + Renk ekle
        </button>
      </div>
    </div>
  );
}

/**
 * Teknik özellikler. Sayılar da ham metin: `value={value.tensileMpa ?? ""}` +
 * anında sayıya çevirme, yazılan noktayı yutuyordu (48 → "48." → 48 → "48").
 */
function PropertiesEditor({
  value,
  onChange,
}: {
  value: PropertiesDraft;
  onChange: (next: PropertiesDraft) => void;
}) {
  return (
    <div className="sm:col-span-2">
      <p className="text-xs font-medium text-gray-600">
        Teknik özellikler (malzeme sayfasında yayımlanır)
      </p>
      <div className="mt-2 grid gap-2 sm:grid-cols-3">
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Çekme dayanımı (MPa)</span>
          <input
            type="text"
            inputMode="decimal"
            value={value.tensileMpa}
            onChange={(e) => onChange({ ...value, tensileMpa: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Kopma uzaması (%)</span>
          <input
            type="text"
            inputMode="decimal"
            value={value.elongationPct}
            onChange={(e) => onChange({ ...value, elongationPct: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
        <label className="flex flex-col gap-1">
          <span className="text-[11px] text-gray-500">Isı dayanımı (°C)</span>
          <input
            type="text"
            inputMode="decimal"
            value={value.heatDeflectionC}
            onChange={(e) => onChange({ ...value, heatDeflectionC: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
      </div>
      <div className="mt-2 flex flex-wrap items-center gap-4">
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={value.flexible}
            onChange={(e) => onChange({ ...value, flexible: e.target.checked })}
            className="h-4 w-4"
          />
          Esnek
        </label>
        <label className="flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={value.transparent}
            onChange={(e) => onChange({ ...value, transparent: e.target.checked })}
            className="h-4 w-4"
          />
          Şeffaf
        </label>
        <label className="flex flex-1 flex-col gap-1">
          <span className="text-[11px] text-gray-500">Kullanım alanları (virgülle)</span>
          <input
            type="text"
            value={value.uses}
            onChange={(e) => onChange({ ...value, uses: e.target.value })}
            className={INPUT_CLASS}
          />
        </label>
      </div>
    </div>
  );
}

function RowForm({
  fields,
  initial,
  submitLabel,
  onSubmit,
}: {
  fields: Field[];
  initial: Draft;
  submitLabel: string;
  onSubmit: (payload: Record<string, unknown>) => Promise<string | null>;
}) {
  const [draft, setDraft] = useState<Draft>(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const set = (name: string, next: DraftValue) =>
    setDraft((prev) => ({ ...prev, [name]: next }));

  const save = async () => {
    setBusy(true);
    setError(null);
    try {
      const message = await onSubmit(toPayload(fields, draft));
      if (message) setError(message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="mt-3 border-t border-gray-100 pt-3">
      {error && (
        <div className="mb-3 rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}
      <div className="grid gap-3 sm:grid-cols-2">
        {fields.map((field) =>
          field.kind === "colors" ? (
            <ColorsEditor
              key={field.name}
              value={(draft[field.name] as ColorDraft[] | undefined) ?? []}
              onChange={(next) => set(field.name, next)}
            />
          ) : field.kind === "properties" ? (
            <PropertiesEditor
              key={field.name}
              value={(draft[field.name] as PropertiesDraft | undefined) ?? EMPTY_PROPERTIES_DRAFT}
              onChange={(next) => set(field.name, next)}
            />
          ) : (
            <FieldInput
              key={field.name}
              field={field}
              value={draft[field.name] ?? ""}
              onChange={(next) => set(field.name, next)}
            />
          )
        )}
      </div>
      <button
        type="button"
        onClick={save}
        disabled={busy}
        className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
      >
        {busy ? "Kaydediliyor…" : submitLabel}
      </button>
    </div>
  );
}

interface CatalogRowLike {
  id: string;
  key: string;
  name: string;
  active: boolean;
  updatedAt: string;
}

function EntityEditor<T extends CatalogRowLike>({
  entity,
  heading,
  intro,
  fields,
  createOnlyFields,
  rows,
  subtitle,
}: {
  entity: EntityName;
  heading: string;
  intro: string;
  fields: Field[];
  createOnlyFields: Field[];
  rows: T[];
  subtitle: (row: T) => string;
}) {
  const router = useRouter();
  const [openId, setOpenId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);
  /**
   * Yazım GEÇTİ ama sahibinin bilmesi gereken bir sonucu var (pasifleştirilen
   * teknolojinin malzemeleri de kapandı gibi). Formun içinde tutulamaz: kayıttan
   * sonra satır tazelenir ve form yeniden kurulur — uyarı da onunla birlikte
   * kaybolurdu.
   */
  const [notices, setNotices] = useState<string[]>([]);

  const createFields = [...createOnlyFields, ...fields];

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm text-gray-600">{intro}</p>

      {notices.length > 0 && (
        <ul className="list-disc space-y-1 rounded-lg border border-amber-200 bg-amber-50 px-6 py-3 text-sm text-amber-900">
          {notices.map((notice) => (
            <li key={notice}>{notice}</li>
          ))}
        </ul>
      )}

      {rows.map((row) => (
        <div key={row.id} className="rounded-xl border border-gray-200 bg-white p-4">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-base font-semibold text-gray-900">{row.name}</span>
            <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">
              {row.key}
            </code>
            <span
              className={`rounded-full px-2 py-0.5 text-xs ${
                row.active ? "bg-green-100 text-green-800" : "bg-gray-200 text-gray-600"
              }`}
            >
              {row.active ? "Aktif" : "Pasif"}
            </span>
            <span className="text-xs text-gray-400">{subtitle(row)}</span>
            <button
              type="button"
              onClick={() => setOpenId(openId === row.id ? null : row.id)}
              className="ml-auto text-sm font-medium text-blue-700 hover:text-blue-900"
            >
              {openId === row.id ? "Kapat" : "Düzenle"}
            </button>
          </div>

          {openId === row.id && (
            <RowForm
              key={`${row.id}-${row.updatedAt}`}
              fields={fields}
              initial={toDraft(fields, row as unknown as Record<string, unknown>)}
              submitLabel="Değişiklikleri kaydet"
              onSubmit={async (payload) => {
                const response = await patchRow(entity, row.id, {
                  ...payload,
                  expectedUpdatedAt: row.updatedAt,
                });
                const message = await readError(response);
                if (message) return message;
                const body = (await response.json().catch(() => ({}))) as {
                  warnings?: string[];
                };
                setNotices(body.warnings ?? []);
                setOpenId(null);
                router.refresh();
                return null;
              }}
            />
          )}
        </div>
      ))}

      <div className="rounded-xl border border-dashed border-gray-300 bg-white p-4">
        <button
          type="button"
          onClick={() => setCreating(!creating)}
          className="text-sm font-semibold text-green-700 hover:text-green-800"
        >
          {creating ? "Vazgeç" : `+ ${heading} ekle`}
        </button>
        {creating && (
          <RowForm
            fields={createFields}
            initial={toDraft(createFields, null)}
            submitLabel={`${heading} ekle`}
            onSubmit={async (payload) => {
              const response = await createRow(entity, payload);
              const message = await readError(response);
              if (message) return message;
              setNotices([]);
              setCreating(false);
              router.refresh();
              return null;
            }}
          />
        )}
      </div>
    </div>
  );
}

// ─── Fiyat ayarları ─────────────────────────────────────────────────────────

const DIYANET_NOTE =
  "Dini bayram tarihlerini Diyanet takviminden doğrulayın.";

function SettingsForm({ settings }: { settings: SettingsRow }) {
  const router = useRouter();
  const [qtyBreaks, setQtyBreaks] = useState(
    settings.qtyBreaks.map((b) => ({ minQty: String(b.minQty), pct: String(b.discountBps / 100) }))
  );
  const [leadTiers, setLeadTiers] = useState(
    LEAD_TIER_KEYS.map((key) => {
      const tier = settings.leadTiers.find((t) => t.key === key);
      return {
        key,
        name: tier?.name ?? "",
        multiplier: String((tier?.multiplierBps ?? BPS_SCALE) / BPS_SCALE),
        daysDelta: String(tier?.daysDelta ?? 0),
        minDays: String(tier?.minDays ?? 1),
      };
    })
  );
  const [numbers, setNumbers] = useState({
    minOrderTl: tl(settings.minOrderKurus),
    maxAutoTotalTl: tl(settings.maxAutoTotalKurus),
    maxAutoQtyPerPart: String(settings.maxAutoQtyPerPart),
    maxPartsPerQuote: String(settings.maxPartsPerQuote),
    maxFileMb: String(Math.round(settings.maxFileBytes / 1048576)),
    quoteValidDays: String(settings.quoteValidDays),
    retentionDaysAfterExpiry: String(settings.retentionDaysAfterExpiry),
    cutoffHour: String(settings.cutoffHour),
    priceBreakQuantities: settings.priceBreakQuantities.join(", "),
  });
  const [havale, setHavale] = useState(settings.havaleDiscountApplies);
  const [holidays, setHolidays] = useState(settings.holidays.join("\n"));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const response = await fetch("/api/admin/print-catalog/settings", {
        method: "PUT",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          expectedUpdatedAt: settings.updatedAt,
          settings: {
            qtyBreaks: qtyBreaks
              .filter((b) => b.minQty.trim() !== "")
              .map((b) => ({
                minQty: Math.round(numberOf(b.minQty)),
                discountBps: Math.round(numberOf(b.pct) * 100),
              })),
            leadTiers: leadTiers.map((t) => ({
              key: t.key,
              name: t.name.trim(),
              multiplierBps: Math.round(numberOf(t.multiplier) * BPS_SCALE),
              daysDelta: Math.round(numberOf(t.daysDelta)),
              minDays: Math.round(numberOf(t.minDays)),
            })),
            minOrderKurus: toKurus(numbers.minOrderTl),
            maxAutoTotalKurus: toKurus(numbers.maxAutoTotalTl),
            maxAutoQtyPerPart: Math.round(numberOf(numbers.maxAutoQtyPerPart)),
            maxPartsPerQuote: Math.round(numberOf(numbers.maxPartsPerQuote)),
            maxFileBytes: Math.round(numberOf(numbers.maxFileMb) * 1048576),
            quoteValidDays: Math.round(numberOf(numbers.quoteValidDays)),
            retentionDaysAfterExpiry: Math.round(numberOf(numbers.retentionDaysAfterExpiry)),
            priceBreakQuantities: toIntList(numbers.priceBreakQuantities),
            holidays: holidays
              .split(/[\s,;]+/)
              .map((s) => s.trim())
              .filter(Boolean),
            cutoffHour: Math.round(numberOf(numbers.cutoffHour)),
            havaleDiscountApplies: havale,
          },
        }),
      });
      const message = await readError(response);
      if (message) {
        setError(message);
        return;
      }
      setSaved(true);
      router.refresh();
    } finally {
      setBusy(false);
    }
  };

  const setNumber = (key: keyof typeof numbers, value: string) =>
    setNumbers((prev) => ({ ...prev, [key]: value }));

  return (
    <div className="space-y-5">
      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-base font-semibold text-gray-900">Adet kademeleri</h3>
        <p className="mt-1 text-xs text-gray-500">
          Adedin girdiği <strong>en yüksek</strong> kademenin indirimi uygulanır. İlk kademe
          1 adetten başlamalı ve adetler kesin artmalı. En fazla %
          {CATALOG_LIMITS.discountBps.max / 100} indirim girilebilir.
        </p>
        <div className="mt-3 space-y-2">
          {qtyBreaks.map((row, i) => (
            <div key={i} className="flex flex-wrap items-center gap-2">
              <span className="text-xs text-gray-500">En az</span>
              <input
                type="text"
                inputMode="numeric"
                value={row.minQty}
                onChange={(e) =>
                  setQtyBreaks((prev) =>
                    prev.map((b, j) => (j === i ? { ...b, minQty: e.target.value } : b))
                  )
                }
                className={`${INPUT_CLASS} w-24`}
              />
              <span className="text-xs text-gray-500">adet →</span>
              <input
                type="text"
                inputMode="decimal"
                value={row.pct}
                onChange={(e) =>
                  setQtyBreaks((prev) =>
                    prev.map((b, j) => (j === i ? { ...b, pct: e.target.value } : b))
                  )
                }
                className={`${INPUT_CLASS} w-24`}
              />
              <span className="text-xs text-gray-500">% indirim</span>
              <button
                type="button"
                onClick={() => setQtyBreaks((prev) => prev.filter((_, j) => j !== i))}
                className="ml-auto text-xs text-gray-400 hover:text-red-600"
              >
                Kaldır
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={() => setQtyBreaks((prev) => [...prev, { minQty: "", pct: "0" }])}
            className="text-sm font-medium text-green-700 hover:text-green-800"
          >
            + Kademe ekle
          </button>
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-base font-semibold text-gray-900">Teslim kademeleri</h3>
        <p className="mt-1 text-xs text-gray-500">
          Üçü de zorunlu. Çarpan birim fiyatı, gün farkı iş gününü değiştirir; hiçbir
          kademe kendi alt sınırının altına inemez.
        </p>
        <div className="mt-3 space-y-2">
          {leadTiers.map((tier, i) => (
            <div key={tier.key} className="grid gap-2 sm:grid-cols-5">
              <code className="self-center text-xs text-gray-500">{tier.key}</code>
              {(
                [
                  ["name", "Ad"],
                  ["multiplier", "Çarpan (×)"],
                  ["daysDelta", "Gün farkı"],
                  ["minDays", "En az iş günü"],
                ] as const
              ).map(([field, label]) => (
                <label key={field} className="flex flex-col gap-1">
                  <span className="text-[11px] text-gray-500">{label}</span>
                  <input
                    type="text"
                    value={tier[field]}
                    onChange={(e) =>
                      setLeadTiers((prev) =>
                        prev.map((t, j) => (j === i ? { ...t, [field]: e.target.value } : t))
                      )
                    }
                    className={INPUT_CLASS}
                  />
                </label>
              ))}
            </div>
          ))}
        </div>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-base font-semibold text-gray-900">Limitler ve politika</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["minOrderTl", "Asgari sipariş tutarı (₺)", "Altında kalan teklife tamamlama satırı eklenir."],
              ["maxAutoTotalTl", "Anlık fiyat üst sınırı (₺)", "Üstündeki teklif incelemeye düşer."],
              ["maxAutoQtyPerPart", "Parça başına en yüksek adet", "Üstü incelemeye düşer."],
              ["maxPartsPerQuote", "Teklif başına en çok parça", ""],
              ["maxFileMb", "En büyük dosya (MB)", "Sunucudaki yükleme sınırıyla uyumlu olmalı."],
              ["quoteValidDays", "Teklif geçerlilik (gün)", ""],
              ["retentionDaysAfterExpiry", "Süre sonrası saklama (gün)", "Dosyalar bu süre sonunda silinir."],
              ["cutoffHour", "Gün kesim saati (0–23)", "Bu saatten sonraki teklif ertesi iş gününden sayılır."],
              ["priceBreakQuantities", "Fiyat kademesi adetleri", "Müşteriye gösterilen adet tablosu."],
            ] as const
          ).map(([key, label, hint]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">{label}</span>
              <input
                type="text"
                value={numbers[key]}
                onChange={(e) => setNumber(key, e.target.value)}
                className={INPUT_CLASS}
              />
              {hint && <span className="text-[11px] text-gray-500">{hint}</span>}
            </label>
          ))}
        </div>
        <label className="mt-4 flex items-center gap-2 text-sm text-gray-800">
          <input
            type="checkbox"
            checked={havale}
            onChange={(e) => setHavale(e.target.checked)}
            className="h-4 w-4"
          />
          Havale indirimi teklif ödemelerinde de geçerli
        </label>
      </section>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <h3 className="text-base font-semibold text-gray-900">Resmî tatiller</h3>
        <p className="mt-1 text-xs text-gray-500">
          İş günü hesabı (teslim tarihi) bu listeyi kullanır. Her satıra bir tarih:
          <code className="mx-1 rounded bg-gray-100 px-1">YYYY-AA-GG</code>. İstanbul takvimi.
        </p>
        <p className="mt-1 text-xs font-semibold text-amber-700">{DIYANET_NOTE}</p>
        <textarea
          rows={10}
          value={holidays}
          onChange={(e) => setHolidays(e.target.value)}
          className={`${INPUT_CLASS} mt-3 w-full font-mono`}
        />
      </section>

      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {busy ? "Kaydediliyor…" : "Fiyat ayarlarını kaydet"}
        </button>
        {saved && <span className="text-sm text-green-700">Kaydedildi ✓</span>}
        <span className="text-xs text-gray-400">
          Son güncelleme: {new Date(settings.updatedAt).toLocaleString("tr-TR")}
          {settings.updatedBy ? ` · ${settings.updatedBy}` : ""}
        </span>
      </div>
    </div>
  );
}

// ─── Simülatör ──────────────────────────────────────────────────────────────

function SimulatorPanel({
  technologies,
  materials,
  finishes,
  leadTierNames,
}: {
  technologies: TechnologyRow[];
  materials: MaterialRow[];
  finishes: FinishRow[];
  leadTierNames: Record<LeadTierKey, string>;
}) {
  const dictionary = useDictionary();
  const activeTechnologies = technologies.filter((t) => t.active);
  const [technologyKey, setTechnologyKey] = useState(activeTechnologies[0]?.key ?? "");
  const technology = activeTechnologies.find((t) => t.key === technologyKey) ?? null;

  const activeMaterials = useMemo(
    () => materials.filter((m) => m.active && m.technologyKey === technologyKey),
    [materials, technologyKey]
  );
  const activeFinishes = useMemo(
    () =>
      finishes.filter(
        (f) => f.active && (f.technologyKey === null || f.technologyKey === technologyKey)
      ),
    [finishes, technologyKey]
  );

  const [materialKey, setMaterialKey] = useState(activeMaterials[0]?.key ?? "");
  const material = activeMaterials.find((m) => m.key === materialKey) ?? activeMaterials[0] ?? null;
  const [colorKey, setColorKey] = useState(material?.colors[0]?.key ?? "");
  const [finishKey, setFinishKey] = useState(activeFinishes[0]?.key ?? "");
  const [layerUm, setLayerUm] = useState(String(technology?.defaultLayerUm ?? ""));
  const [infillPct, setInfillPct] = useState(
    technology?.defaultInfillPct === null || technology?.defaultInfillPct === undefined
      ? ""
      : String(technology.defaultInfillPct)
  );
  const [quantity, setQuantity] = useState("1");
  const [leadTier, setLeadTier] = useState<LeadTierKey>("standard");
  const [geometry, setGeometry] = useState({
    volumeCm3: "8",
    areaCm2: "24",
    x: "20",
    y: "20",
    z: "20",
  });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<QuoteSimulationResult | null>(null);

  const pickTechnology = (key: string) => {
    setTechnologyKey(key);
    const tech = activeTechnologies.find((t) => t.key === key) ?? null;
    const first = materials.find((m) => m.active && m.technologyKey === key) ?? null;
    setMaterialKey(first?.key ?? "");
    setColorKey(first?.colors[0]?.key ?? "");
    setFinishKey(
      finishes.find((f) => f.active && (f.technologyKey === null || f.technologyKey === key))?.key ??
        ""
    );
    setLayerUm(String(tech?.defaultLayerUm ?? ""));
    setInfillPct(
      tech === null || tech.defaultInfillPct === null ? "" : String(tech.defaultInfillPct)
    );
    setResult(null);
  };

  const run = async () => {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/admin/print-catalog/simulate", {
        method: "POST",
        headers: JSON_HEADERS,
        body: JSON.stringify({
          technologyKey,
          materialKey,
          colorKey,
          finishKey,
          layerUm: layerUm.trim() === "" ? null : Math.round(numberOf(layerUm)),
          infillPct: infillPct.trim() === "" ? null : Math.round(numberOf(infillPct)),
          quantity: Math.round(numberOf(quantity)),
          leadTier,
          geometry: {
            volumeCm3: numberOf(geometry.volumeCm3),
            areaCm2: numberOf(geometry.areaCm2),
            x: numberOf(geometry.x),
            y: numberOf(geometry.y),
            z: numberOf(geometry.z),
          },
        }),
      });
      const message = await readError(response);
      if (message) {
        setResult(null);
        setError(message);
        return;
      }
      const body = (await response.json()) as { result: QuoteSimulationResult };
      setResult(body.result);
    } finally {
      setBusy(false);
    }
  };

  const describe = (issue: DfmIssue) => dfmMessage(dictionary, issue);

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm text-gray-600">
        Ölçüleri girin, <strong>bugünkü aktif katalogla</strong> çıkacak fiyatı görün. Hesap
        müşteriye gösterilen ve tahsil edilen fiyatla aynı yoldan (
        <code className="rounded bg-gray-100 px-1">computeQuote</code>) yapılır; burada hiçbir
        şey kaydedilmez.
      </p>

      <section className="rounded-xl border border-gray-200 bg-white p-5">
        <div className="grid gap-3 sm:grid-cols-3">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Teknoloji</span>
            <select
              value={technologyKey}
              onChange={(e) => pickTechnology(e.target.value)}
              className={INPUT_CLASS}
            >
              {activeTechnologies.map((t) => (
                <option key={t.key} value={t.key}>
                  {t.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Malzeme</span>
            <select
              value={materialKey}
              onChange={(e) => {
                setMaterialKey(e.target.value);
                const next = activeMaterials.find((m) => m.key === e.target.value);
                setColorKey(next?.colors[0]?.key ?? "");
              }}
              className={INPUT_CLASS}
            >
              {activeMaterials.map((m) => (
                <option key={m.key} value={m.key}>
                  {m.name}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Renk</span>
            <select
              value={colorKey}
              onChange={(e) => setColorKey(e.target.value)}
              className={INPUT_CLASS}
            >
              {(material?.colors ?? []).map((c) => (
                <option key={c.key} value={c.key}>
                  {c.name}
                  {c.surchargeKurus > 0 ? ` (+${kurusTr(c.surchargeKurus)})` : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Yüzey işlemi</span>
            <select
              value={finishKey}
              onChange={(e) => setFinishKey(e.target.value)}
              className={INPUT_CLASS}
            >
              {activeFinishes.map((f) => (
                <option key={f.key} value={f.key}>
                  {f.name}
                  {f.requiresManual ? " (elle fiyatlanır)" : ""}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Katman (µm)</span>
            <select
              value={layerUm}
              onChange={(e) => setLayerUm(e.target.value)}
              className={INPUT_CLASS}
            >
              {(technology?.layerOptionsUm ?? []).map((v) => (
                <option key={v} value={String(v)}>
                  {v}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Doluluk (%)</span>
            <select
              value={infillPct}
              onChange={(e) => setInfillPct(e.target.value)}
              className={INPUT_CLASS}
              disabled={!technology?.infillOptionsPct}
            >
              {technology?.infillOptionsPct ? (
                technology.infillOptionsPct.map((v) => (
                  <option key={v} value={String(v)}>
                    {v}
                  </option>
                ))
              ) : (
                <option value="">Katı baskı</option>
              )}
            </select>
          </label>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          {(
            [
              ["volumeCm3", "Hacim (cm³)"],
              ["areaCm2", "Yüzey alanı (cm²)"],
              ["x", "Genişlik X (mm)"],
              ["y", "Derinlik Y (mm)"],
              ["z", "Yükseklik Z (mm)"],
            ] as const
          ).map(([key, label]) => (
            <label key={key} className="flex flex-col gap-1">
              <span className="text-xs font-medium text-gray-600">{label}</span>
              <input
                type="text"
                inputMode="decimal"
                value={geometry[key]}
                onChange={(e) => setGeometry((prev) => ({ ...prev, [key]: e.target.value }))}
                className={INPUT_CLASS}
              />
            </label>
          ))}
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Adet</span>
            <input
              type="text"
              inputMode="numeric"
              value={quantity}
              onChange={(e) => setQuantity(e.target.value)}
              className={INPUT_CLASS}
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-gray-600">Teslim kademesi</span>
            <select
              value={leadTier}
              onChange={(e) => setLeadTier(e.target.value as LeadTierKey)}
              className={INPUT_CLASS}
            >
              {LEAD_TIER_KEYS.map((key) => (
                <option key={key} value={key}>
                  {leadTierNames[key]}
                </option>
              ))}
            </select>
          </label>
        </div>

        <button
          type="button"
          onClick={run}
          disabled={busy}
          className="mt-4 rounded-lg bg-gray-900 px-4 py-2 text-sm font-semibold text-white hover:bg-gray-800 disabled:opacity-60"
        >
          {busy ? "Hesaplanıyor…" : "Fiyatı hesapla"}
        </button>
      </section>

      {error && (
        <div className="rounded border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {result && !result.ok && (
        <section className="rounded-xl border border-amber-200 bg-amber-50 p-5">
          <h3 className="text-base font-semibold text-amber-900">Anlık fiyat verilemiyor</h3>
          <ul className="mt-2 list-disc space-y-1 pl-5 text-sm text-amber-900">
            {result.dfm.map((issue, i) => (
              <li key={`${issue.code}-${i}`}>{describe(issue)}</li>
            ))}
          </ul>
          <p className="mt-2 text-xs text-amber-800">
            Gerekçe kodu: <code>{result.reason}</code> — bu yapılandırma müşteride manuel
            teklife düşer.
          </p>
        </section>
      )}

      {result && result.ok && (
        <section className="rounded-xl border border-gray-200 bg-white p-5">
          <h3 className="text-base font-semibold text-gray-900">
            Birim fiyat {kurusTr(result.unitKurus)} · satır {kurusTr(result.lineKurus)}
          </h3>
          <p className="mt-1 text-xs text-gray-500">
            KDV dahil. Kalemler <strong>birim fiyat üzerindendir</strong> ve toplamı kuruşu
            kuruşuna birim fiyata eşittir.
          </p>

          <table className="mt-3 w-full text-sm">
            <tbody>
              {result.unitLines.map((line) => (
                <tr key={line.key} className="border-b border-gray-100 last:border-0">
                  <td className="py-1.5 pr-3 text-gray-700">{line.label}</td>
                  <td className="py-1.5 text-right tabular-nums text-gray-900">
                    {line.kurus < 0 ? "−" : ""}
                    {kurusTr(Math.abs(line.kurus))}
                  </td>
                </tr>
              ))}
              <tr className="border-t-2 border-gray-300">
                <td className="py-2 pr-3 font-semibold text-gray-900">Birim fiyat</td>
                <td className="py-2 text-right font-semibold tabular-nums text-gray-900">
                  {kurusTr(result.unitKurus)}
                </td>
              </tr>
            </tbody>
          </table>

          {result.floorApplied && (
            <p className="mt-3 rounded border border-blue-200 bg-blue-50 px-3 py-2 text-xs text-blue-800">
              Bu parçada <strong>birim taban fiyatı</strong> ({kurusTr(result.minUnitPriceKurus)})
              devreye girdi: hesaplanan malzeme + makine + yüzey + renk toplamı tabanın altında
              kaldı, fark yukarıdaki &quot;taban fiyat farkı&quot; satırıdır.
            </p>
          )}

          <dl className="mt-4 grid gap-2 text-xs text-gray-600 sm:grid-cols-3">
            <div>
              <dt className="font-medium text-gray-700">Efektif hacim</dt>
              <dd>{trField(result.breakdown.effectiveVolumeCm3, 3)} cm³</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-700">Malzeme ağırlığı</dt>
              <dd>{trField(result.breakdown.grams, 2)} g</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-700">Makine süresi</dt>
              <dd>{trField(result.breakdown.hours, 3)} saat</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-700">Kurulum ücreti birim payı</dt>
              <dd>{kurusTr(result.setupPerUnitKurus)}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-700">İş günü</dt>
              <dd>{result.leadDays}</dd>
            </div>
            <div>
              <dt className="font-medium text-gray-700">Teklif toplamı (KDV dahil)</dt>
              <dd>{kurusTr(result.totals.totalKurus)}</dd>
            </div>
          </dl>

          {result.totals.minOrderTopUpKurus > 0 && (
            <p className="mt-3 text-xs text-gray-500">
              Teklif toplamına asgari sipariş tamamlaması eklendi:{" "}
              {kurusTr(result.totals.minOrderTopUpKurus)}.
            </p>
          )}

          {result.dfm.length > 0 && (
            <ul className="mt-3 list-disc space-y-1 pl-5 text-xs text-amber-800">
              {result.dfm.map((issue, i) => (
                <li key={`${issue.code}-${i}`}>{describe(issue)}</li>
              ))}
            </ul>
          )}
        </section>
      )}
    </div>
  );
}

// ─── Kabuk ──────────────────────────────────────────────────────────────────

const TABS = [
  ["technologies", "Teknolojiler"],
  ["materials", "Malzemeler"],
  ["finishes", "Yüzey işlemleri"],
  ["addons", "Ek hizmetler"],
  ["settings", "Fiyat ayarları"],
  ["simulator", "Simülatör"],
] as const;

type TabKey = (typeof TABS)[number][0];

export function CatalogClient({
  technologies,
  materials,
  finishes,
  addons,
  settings,
  changes,
}: {
  technologies: TechnologyRow[];
  materials: MaterialRow[];
  finishes: FinishRow[];
  addons: AddonRow[];
  settings: SettingsRow;
  changes: ChangeRow[];
}) {
  const [tab, setTab] = useState<TabKey>("technologies");

  const technologyOptions = technologies.map((t) => ({
    value: t.id,
    label: `${t.name}${t.active ? "" : " (pasif)"}`,
  }));

  // Simülatörün kademe listesi AYARLARDAN gelir: kademeyi yeniden adlandıran
  // yönetici, simülatörde hâlâ eski adı görmemeli.
  const leadTierNames = Object.fromEntries(
    LEAD_TIER_KEYS.map((key) => [key, settings.leadTiers.find((t) => t.key === key)?.name ?? key])
  ) as Record<LeadTierKey, string>;

  return (
    <div className="mt-6">
      <nav className="flex flex-wrap gap-2 border-b border-gray-200 pb-2">
        {TABS.map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
              tab === key
                ? "bg-gray-900 text-white"
                : "bg-gray-100 text-gray-700 hover:bg-gray-200"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <div className="mt-6">
        {tab === "technologies" && (
          <EntityEditor
            entity="technology"
            heading="Teknoloji"
            intro="Makine ekonomisi: kurulum ücreti, saat ücreti, debi ve birim taban fiyatı buradan gelir. Pasifleştirilen teknolojinin malzemeleri de müşteriye kapanır."
            fields={TECHNOLOGY_FIELDS}
            createOnlyFields={[KEY_FIELD("teknoloji")]}
            rows={technologies}
            subtitle={(tech) =>
              `${tech.buildXMm}×${tech.buildYMm}×${tech.buildZMm} mm · taban ${kurusTr(tech.minUnitPriceKurus)}`
            }
          />
        )}

        {tab === "materials" && (
          <EntityEditor
            entity="material"
            heading="Malzeme"
            intro="Gram fiyatı, yoğunluk ve destek katsayısı malzeme kalemini belirler; renkler ve ek ücretleri de burada."
            fields={MATERIAL_FIELDS}
            createOnlyFields={[
              {
                name: "technologyId",
                label: "Teknoloji (sonradan değiştirilemez)",
                kind: "select",
                // Seçimsiz bir liste, kaydetmeye basınca "geçersiz uuid"
                // demekti: ilk teknoloji ÖNCEDEN seçili gelir.
                initial: technologies[0]?.id ?? "",
                options: technologyOptions,
              },
              KEY_FIELD("malzeme"),
            ]}
            rows={materials}
            subtitle={(material) =>
              `${material.technologyKey} · ${kurusTr(material.priceKurusPerGram)}/g · ${material.colors.length} renk`
            }
          />
        )}

        {tab === "finishes" && (
          <EntityEditor
            entity="finish"
            heading="Yüzey işlemi"
            intro="Sabit + alan başına ücret birim fiyata girer. 'Elle fiyatlanır' işaretli yüzey seçilen parça anlık fiyat almaz, manuel teklife düşer."
            fields={FINISH_FIELDS}
            createOnlyFields={[
              {
                name: "technologyId",
                label: "Teknoloji (boş = tüm teknolojiler, sonradan değiştirilemez)",
                kind: "select",
                nullable: true,
                options: technologyOptions,
              },
              KEY_FIELD("yüzey işlemi"),
            ]}
            rows={finishes}
            subtitle={(finish) =>
              `${finish.technologyKey ?? "tüm teknolojiler"} · ${kurusTr(finish.fixedKurus)} + ${kurusTr(finish.perCm2Kurus)}/cm²${finish.requiresManual ? " · elle" : ""}`
            }
          />
        )}

        {tab === "addons" && (
          <EntityEditor
            entity="addon"
            heading="Ek hizmet"
            intro="Teklif düzeyinde satılan belgeler ve hizmetler (sertifika, ölçüm raporu…). Fiyat türü tutarın nasıl çarpıldığını belirler."
            fields={ADDON_FIELDS}
            createOnlyFields={[KEY_FIELD("ek hizmet")]}
            rows={addons}
            subtitle={(addon) => `${kurusTr(addon.priceKurus)} · ${addon.priceType}`}
          />
        )}

        {tab === "settings" && <SettingsForm key={settings.updatedAt} settings={settings} />}

        {tab === "simulator" && (
          <SimulatorPanel
            technologies={technologies}
            materials={materials}
            finishes={finishes}
            leadTierNames={leadTierNames}
          />
        )}
      </div>

      <section className="mt-10 rounded-xl border border-gray-200 bg-white p-5">
        <h2 className="text-base font-semibold text-gray-900">Son katalog değişiklikleri</h2>
        <p className="mt-1 text-xs text-gray-500">
          Her yazım, değişikliğin kendisiyle aynı işlemde kaydedilir.
        </p>
        {changes.length === 0 ? (
          <p className="mt-3 text-sm text-gray-500">Henüz kayıtlı değişiklik yok.</p>
        ) : (
          <ul className="mt-3 space-y-1 text-sm text-gray-700">
            {changes.map((change) => (
              <li key={change.id} className="flex flex-wrap gap-2">
                <span className="tabular-nums text-gray-400">
                  {new Date(change.createdAt).toLocaleString("tr-TR")}
                </span>
                <span className="font-medium">{change.entity}</span>
                <span className="text-gray-500">{change.action}</span>
                <span className="text-gray-500">{change.adminEmail}</span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}
