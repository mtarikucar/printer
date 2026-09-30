"use client";

/**
 * Tek çerçeve anlaşmanın karar ekranı.
 *
 * ─── EKRANDA PARA ARİTMETİĞİ YOKTUR ────────────────────────────────────────
 *
 * Bu dosyada çarpma, bölme ve oran YOKTUR. Her tutar uçtan hazır gelir:
 * taahhüt toplamı ve Σ parti tutarı AYRI alanlardır (`FrameworkSummary`),
 * parti tutarı önizlemesi sunucudan (`dryRun`), parti başına para dökümü
 * `deriveOrderMoneyBreakdown`tan.
 *
 * ─── SEKİZ DÜĞME, TEK İSTEK İŞLEVİ ─────────────────────────────────────────
 *
 * Başarı cümlesi İŞLEMDEN gelir (`frameworkNotice`, saf modül): ortak bir
 * cümle, kilit uzatmada "parti serbest bırakıldı" derdi.
 *
 * ─── İLERİYE DÖNÜK YÜK GÖSTERİMDİR ─────────────────────────────────────────
 *
 * Tezgâh etiketi sunucuda üretilmiş HAZIR bir dizedir; bu ekran ne eşik kurar
 * ne kapasite sorgusu yazar (`manufacturer-capacity.ts` KARAR 2: `loadUnits`
 * KAPIDIR, gerisi gösterimdir). Planlı parti tezgâhta yer kaplamaz.
 */
import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  BatchPlanner,
  type PlanPreviewRow,
} from "@/components/framework/batch-planner";
import { BatchTimeline, type BatchRow } from "@/components/framework/batch-timeline";
import { FrameworkProgressBars } from "@/components/framework/progress-bars";
import {
  FrameworkSummary,
  type CommitmentRow,
} from "@/components/framework/framework-summary";
import type {
  FrameworkPartProgress,
  FrameworkProgress,
  FrameworkStatus,
} from "@/lib/config/quote-framework";
import type { TurkishAddress } from "@/lib/db/schema";
import type { FrameworkAuditRow, FrameworkForwardLoad } from "@/lib/services/quote-framework";
import { formatDate, formatDateTime } from "@/lib/i18n/format";
import {
  FRAMEWORK_STATUS_LABELS_TR,
  FRAMEWORK_STATUS_TONES,
  frameworkNotice,
  type FrameworkActionKey,
} from "./framework-values";

const ACTION_LABELS: Record<string, string> = {
  manual_price: "Manuel fiyat",
  target_accept: "Hedef fiyat kabul",
  target_counter: "Karşı teklif",
  target_reject: "Hedef fiyat reddi",
  review_reject: "İnceleme kapatıldı",
  extend_expiry: "Süre uzatıldı",
  reopen: "Yeniden açıldı",
  framework_create: "Çerçeve anlaşma kuruldu",
  framework_activate: "Anlaşma aktifleştirildi",
  framework_batch_plan: "Parti planlandı",
  framework_batch_release: "Parti serbest bırakıldı",
  framework_batch_cancel: "Parti iptal edildi",
  framework_cancel: "Anlaşma iptal edildi",
  framework_extend: "Fiyat kilidi uzatıldı",
};

export interface FrameworkView {
  id: string;
  number: string;
  status: FrameworkStatus;
  title: string | null;
  quoteId: string;
  quoteNumber: string;
  leadTier: string;
  leadDays: number | null;
  committedUnits: number;
  committedTotalKurus: number;
  batchesTotalKurus: number;
  priceLockedUntil: string;
  lockExpired: boolean;
  preferredManufacturerId: string | null;
  preferredManufacturerName: string | null;
  shippingAddress: TurkishAddress;
  termsVersion: string | null;
  termsAcceptedAt: string | null;
  customerNote: string | null;
  adminNote: string | null;
  activatedAt: string | null;
  activatedByEmail: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  createdAt: string;
  parts: CommitmentRow[];
  addons: Array<{ key: string; name: string; kurus: number }>;
  progress: { total: FrameworkProgress; byPart: FrameworkPartProgress[] };
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-gray-200 bg-white p-5">
      <h2 className="text-sm font-semibold uppercase tracking-wide text-gray-500">{title}</h2>
      <div className="mt-3">{children}</div>
    </section>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex justify-between gap-4 py-1 text-sm">
      <span className="text-gray-500">{label}</span>
      <span className="text-right text-gray-900">{children}</span>
    </div>
  );
}

function ReasonField({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) {
  return (
    <label className="mt-3 block text-sm">
      <span className="block text-xs text-gray-500">
        Gerekçe (en az 10 karakter — denetim izine yazılır)
      </span>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        rows={2}
        className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1"
      />
    </label>
  );
}

export function FrameworkDetailClient({
  framework,
  batches,
  shops,
  shopsUnreadable,
  benchLabel,
  benchUnreadable,
  forwardLoad,
  audit,
  auditUnreadable,
}: {
  framework: FrameworkView;
  batches: BatchRow[];
  shops: Array<{ id: string; companyName: string }>;
  shopsUnreadable: boolean;
  benchLabel: string | null;
  benchUnreadable: boolean;
  forwardLoad: FrameworkForwardLoad | null;
  audit: FrameworkAuditRow[];
  auditUnreadable: boolean;
}) {
  const router = useRouter();
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [refusals, setRefusals] = useState<string[]>([]);
  const [preview, setPreview] = useState<PlanPreviewRow[] | null>(null);

  // ÜÇ AYRI gerekçe alanı, üçü AYRI state: tek state'e bağlanmış üç metin
  // alanı birbirini yansıtır ve admin bir kartta yazdığı gerekçeyi öteki
  // kartta görünce hangisinin gönderileceğini tahmin etmek zorunda kalır
  // (karar ekranının `reason` / `extendReason` ayırımıyla aynı gerekçe).
  const [batchReason, setBatchReason] = useState("");
  const [prefsReason, setPrefsReason] = useState("");
  const [decisionReason, setDecisionReason] = useState("");
  const [lockDate, setLockDate] = useState("");
  const [anchor, setAnchor] = useState(framework.preferredManufacturerId ?? "");
  const [adminNote, setAdminNote] = useState(framework.adminNote ?? "");

  const partNames: Record<string, string> = Object.fromEntries(
    framework.parts.map((p) => [
      p.partId,
      `P${String(p.position).padStart(2, "0")} · ${p.name}`,
    ])
  );
  const remainingByPart = new Map(
    framework.progress.byPart.map((row) => [row.partId, row.unplannedUnits])
  );
  const planParts = framework.parts.map((p) => ({
    partId: p.partId,
    position: p.position,
    name: p.name,
    remaining: remainingByPart.get(p.partId) ?? 0,
  }));
  const liveBatchCount = batches.filter((b) => b.status !== "cancelled").length;
  const plannable = framework.status === "draft" || framework.status === "active";

  /**
   * Sekiz düğmenin ortak isteği. Cevaptaki `refusals` AYRI gösterilir: saf kapı
   * kuralları birbirini maskelemez, yoksa admin bir düzeltmeden sonra ikinci
   * duvara toslar.
   */
  const call = async (
    action: FrameworkActionKey,
    path: string,
    body: unknown,
    opts: { method?: string; busyKey?: string; keepPreview?: boolean } = {}
  ) => {
    setBusy(opts.busyKey ?? action);
    setError(null);
    setNotice(null);
    setRefusals([]);
    if (!opts.keepPreview) setPreview(null);
    try {
      const response = await fetch(`/api/admin/frameworks/${framework.id}${path}`, {
        method: opts.method ?? "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = (await response.json().catch(() => ({}))) as {
        error?: string;
        refusals?: Array<{ message: string }>;
        batches?: PlanPreviewRow[];
      };
      if (!response.ok) {
        setError(data.error ?? `İşlem tamamlanamadı (HTTP ${response.status}).`);
        setRefusals((data.refusals ?? []).map((r) => r.message));
        return;
      }
      setNotice(frameworkNotice(action));
      if (action === "plan-preview") {
        setPreview(data.batches ?? []);
        return;
      }
      // Gönderilen gerekçe alanı temizlenir; ötekiler admin'in yazdığı hâlde
      // KALIR (yanlış alanı silmek, yazılmış bir gerekçeyi kaybettirirdi).
      if (action === "release" || action === "batch-cancel") setBatchReason("");
      else if (action === "preferences") setPrefsReason("");
      else setDecisionReason("");
      router.refresh();
    } catch {
      setError(
        "Sunucuya ulaşılamadı; işlemin geçip geçmediğini görmek için sayfayı yenileyin."
      );
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="p-4 sm:p-8">
      <Link href="/admin/cerceve" className="text-sm text-green-700 hover:underline">
        ← Çerçeve siparişler
      </Link>

      <header className="mt-2 flex flex-wrap items-center gap-3">
        <h1 className="text-2xl font-bold text-gray-900">{framework.number}</h1>
        <span
          className={`rounded-full px-3 py-1 text-xs font-medium ${FRAMEWORK_STATUS_TONES[framework.status]}`}
        >
          {FRAMEWORK_STATUS_LABELS_TR[framework.status]}
        </span>
        {framework.title && <span className="text-sm text-gray-500">{framework.title}</span>}
        <Link
          href={`/admin/teklifler/${framework.quoteId}`}
          className="text-sm text-green-700 hover:underline"
        >
          Kaynak teklif: {framework.quoteNumber}
        </Link>
      </header>

      {framework.lockExpired && framework.status !== "cancelled" && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900"
        >
          <strong>Fiyat kilidinin son günü geçti.</strong> Parti serbest bırakma
          reddedilir. Kilidi aşağıdan uzatın (gerekçe zorunlu) ya da yeni bir anlaşma
          kurun. Serbest bırakılmış partiler bundan etkilenmez.
        </div>
      )}

      {error && (
        <div
          role="alert"
          className="mt-4 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-700"
        >
          {error}
          {refusals.length > 0 && (
            <ul className="mt-2 list-disc pl-5">
              {refusals.map((r) => (
                <li key={r}>{r}</li>
              ))}
            </ul>
          )}
        </div>
      )}
      {notice && (
        <div className="mt-4 rounded-lg border border-green-300 bg-green-50 px-4 py-3 text-sm text-green-800">
          {notice}
        </div>
      )}

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card title="Taahhüt">
            <FrameworkSummary
              parts={framework.parts}
              addons={framework.addons}
              committedUnits={framework.committedUnits}
              committedTotalKurus={framework.committedTotalKurus}
              batchesTotalKurus={framework.batchesTotalKurus}
            />
          </Card>

          <Card title="İlerleme">
            <FrameworkProgressBars
              progress={framework.progress.total}
              byPart={framework.progress.byPart}
              partNames={partNames}
            />
          </Card>

          <Card title="Partiler">
            <BatchTimeline
              batches={batches}
              totalBatches={liveBatchCount}
              partNames={partNames}
              busy={busy}
              onRelease={(batch) =>
                call(
                  "release",
                  `/batches/${batch.id}/release`,
                  {
                    reason: batchReason,
                    // Ekranın gördüğü tutar bir BEYANDIR: uyuşmazsa uç 409
                    // döner ve yanlış rakamla ödeme açılmaz.
                    expectedAmountKurus: batch.amountKurus,
                  },
                  { busyKey: `release:${batch.id}` }
                )
              }
              onCancel={(batch) =>
                call(
                  "batch-cancel",
                  `/batches/${batch.id}/cancel`,
                  { reason: batchReason },
                  { busyKey: `batch-cancel:${batch.id}` }
                )
              }
            />
            <div className="mt-4 border-t border-gray-100 pt-3">
              <ReasonField value={batchReason} onChange={setBatchReason} />
              <p className="mt-1 text-xs text-gray-500">
                Serbest bırakma ve parti iptali bu gerekçeyi kullanır. Serbest
                bırakma, müşteriye ödenebilir bir teklif açar.
              </p>
            </div>
          </Card>

          <Card title="Parti planlayıcı">
            <BatchPlanner
              parts={planParts}
              busy={busy}
              disabled={!plannable}
              disabledReason={
                plannable
                  ? undefined
                  : `Bu anlaşmada parti planlanamaz (durum: ${FRAMEWORK_STATUS_LABELS_TR[framework.status]}). Yalnız taslak ya da aktif anlaşmada plan yapılır.`
              }
              preview={preview}
              onPreview={(args) =>
                call(
                  "plan-preview",
                  "/batches",
                  {
                    batches: [
                      {
                        plannedShipDate: args.plannedShipDate,
                        lines: args.lines,
                        ...(args.note ? { note: args.note } : {}),
                      },
                    ],
                    reason: args.reason,
                    dryRun: true,
                  },
                  { keepPreview: true }
                )
              }
              onPlan={(args) =>
                call("plan", "/batches", {
                  batches: [
                    {
                      plannedShipDate: args.plannedShipDate,
                      lines: args.lines,
                      ...(args.note ? { note: args.note } : {}),
                    },
                  ],
                  reason: args.reason,
                })
              }
            />
          </Card>

          <Card title="Denetim izi">
            {auditUnreadable && (
              <p
                role="alert"
                className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                Denetim izi şu anda okunamadı. Listenin boşluğu &quot;karar yok&quot;
                anlamına GELMEZ.
              </p>
            )}
            {!auditUnreadable && audit.length === 0 ? (
              <p className="text-sm text-gray-500">
                Bu anlaşmanın kaynak teklifinde henüz admin kararı yok.
              </p>
            ) : (
              <ul className="space-y-3">
                {audit.map((entry) => (
                  <li key={entry.id} className="border-b border-gray-100 pb-2 last:border-0">
                    <div className="flex flex-wrap justify-between gap-2 text-sm">
                      <span className="font-medium text-gray-900">
                        {ACTION_LABELS[entry.action] ?? entry.action}
                      </span>
                      <span className="text-xs text-gray-500">
                        {entry.adminEmail} · {formatDateTime(entry.createdAt, "tr")}
                      </span>
                    </div>
                    <p className="mt-1 text-sm text-gray-600">{entry.reason}</p>
                    <details className="mt-1">
                      <summary className="cursor-pointer text-xs text-gray-400">
                        Önce / sonra
                      </summary>
                      <pre className="mt-1 overflow-x-auto rounded bg-gray-50 p-2 text-[11px] text-gray-600">
                        {JSON.stringify({ before: entry.before, after: entry.after }, null, 2)}
                      </pre>
                    </details>
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>

        <div className="space-y-6">
          <Card title="Anlaşma">
            <Row label="Durum">{FRAMEWORK_STATUS_LABELS_TR[framework.status]}</Row>
            <Row label="Taahhüt">{framework.committedUnits} adet</Row>
            <Row label="Teslim kademesi">{framework.leadTier}</Row>
            <Row label="İş günü">{framework.leadDays ?? "—"}</Row>
            <Row label="Fiyat kilidi">
              <span className={framework.lockExpired ? "text-red-600" : undefined}>
                {formatDate(framework.priceLockedUntil, "tr")}
              </span>
            </Row>
            <Row label="Kuruldu">{formatDateTime(framework.createdAt, "tr")}</Row>
            {framework.activatedAt && (
              <Row label="Aktifleşti">
                {formatDateTime(framework.activatedAt, "tr")}
                {framework.activatedByEmail ? ` · ${framework.activatedByEmail}` : ""}
              </Row>
            )}
            {framework.cancelledAt && (
              <Row label="İptal">
                {formatDateTime(framework.cancelledAt, "tr")}
                {framework.cancelReason ? ` · ${framework.cancelReason}` : ""}
              </Row>
            )}
            {framework.termsVersion && (
              <Row label="Şartlar">
                {framework.termsVersion}
                {framework.termsAcceptedAt
                  ? ` · ${formatDate(framework.termsAcceptedAt, "tr")}`
                  : " · kabul edilmedi"}
              </Row>
            )}
          </Card>

          <Card title="Teslim adresi">
            <p className="text-sm text-gray-700">
              {framework.shippingAddress.adres}
              {framework.shippingAddress.mahalle ? `, ${framework.shippingAddress.mahalle}` : ""}
              <br />
              {framework.shippingAddress.ilce} / {framework.shippingAddress.il}{" "}
              {framework.shippingAddress.postaKodu}
              <br />
              {framework.shippingAddress.telefon}
            </p>
            <p className="mt-2 text-xs text-gray-500">
              Anlaşma TEK adres kilitler: farklı adres ikinci bir anlaşmadır (fiyat
              konfigürasyona bağlıdır).
            </p>
          </Card>

          <Card title="Tercih edilen üretici">
            {shopsUnreadable && (
              <p
                role="alert"
                className="mb-3 rounded-lg border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900"
              >
                Atölye listesi okunamadı; seçici boş görünüyor ama atölye YOK demek
                değildir.
              </p>
            )}
            <label className="block text-sm">
              <span className="block text-xs text-gray-500">Çapalı atölye</span>
              <select
                value={anchor}
                onChange={(e) => setAnchor(e.target.value)}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1"
              >
                <option value="">— çapa yok (sıralama seçsin) —</option>
                {shops.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.companyName}
                  </option>
                ))}
              </select>
            </label>
            <label className="mt-3 block text-sm">
              <span className="block text-xs text-gray-500">Admin notu</span>
              <textarea
                value={adminNote}
                onChange={(e) => setAdminNote(e.target.value)}
                rows={3}
                className="mt-1 w-full rounded-lg border border-gray-300 px-2 py-1"
              />
            </label>
            <ReasonField value={prefsReason} onChange={setPrefsReason} />
            <button
              type="button"
              disabled={busy !== null}
              onClick={() =>
                call(
                  "preferences",
                  "",
                  {
                    reason: prefsReason,
                    adminNote,
                    preferredManufacturerId: anchor === "" ? null : anchor,
                  },
                  { method: "PATCH" }
                )
              }
              className="mt-3 rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-40"
            >
              {busy === "preferences" ? "Kaydediliyor…" : "Tercihleri kaydet"}
            </button>
            <p className="mt-2 text-xs text-gray-500">
              Çapa yalnız atamanın <strong>ilk adayıdır</strong>. Mülkiyet, aktiflik,
              malzeme, büyük format, sipariş kabulü ve kapasite kapılarının hepsi aynen
              uygulanır; atölye uygun değilse sıralama seçer ve gerekçe siparişin
              notuna yazılır.
            </p>

            {framework.preferredManufacturerName && (
              <div className="mt-3 rounded-xl bg-gray-50 p-3 text-xs">
                <div className="font-medium text-gray-700">
                  {framework.preferredManufacturerName}
                </div>
                {benchUnreadable ? (
                  <p role="alert" className="mt-1 text-amber-800">
                    Tezgâh yükü okunamadı (BOŞ değil, bilinmiyor).
                  </p>
                ) : (
                  <div className="mt-1 text-gray-600">
                    Tezgâh: {benchLabel ?? "—"}
                  </div>
                )}
                {forwardLoad && (
                  <div className="mt-1 text-gray-600">
                    Önümüzdeki {forwardLoad.windowDays} günde planlanan:{" "}
                    {forwardLoad.batchCount} parti · {forwardLoad.units} adet ·{" "}
                    {forwardLoad.loadUnits} birim
                  </div>
                )}
                <p className="mt-2 text-[11px] text-gray-500">
                  İleriye dönük yük <strong>GÖSTERİMDİR, kapı değildir</strong>: planlı
                  parti tezgâhta yer kaplamaz (ortada sipariş yoktur). Atamanın tek
                  ölçüsü tezgâhın ağırlıklı yüküdür.
                </p>
              </div>
            )}
          </Card>

          <Card title="Diğer kararlar">
            <label className="block text-sm">
              <span className="block text-xs text-gray-500">
                Yeni fiyat kilidi son günü
              </span>
              <input
                type="date"
                value={lockDate}
                onChange={(e) => setLockDate(e.target.value)}
                className="mt-1 rounded-lg border border-gray-300 px-2 py-1"
              />
            </label>
            <ReasonField value={decisionReason} onChange={setDecisionReason} />
            <div className="mt-3 flex flex-col gap-2">
              <button
                type="button"
                disabled={busy !== null}
                onClick={() =>
                  call("extend", "/extend", {
                    priceLockedUntil: lockDate,
                    reason: decisionReason,
                  })
                }
                className="rounded-lg border border-gray-300 px-4 py-2 text-sm text-gray-700 disabled:opacity-40"
              >
                {busy === "extend" ? "Uzatılıyor…" : "Fiyat kilidini uzat"}
              </button>
              {framework.status === "draft" && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => call("activate", "/activate", { reason: decisionReason })}
                  className="rounded-lg bg-green-600 px-4 py-2 text-sm font-medium text-white disabled:opacity-40"
                >
                  {busy === "activate" ? "Aktifleştiriliyor…" : "Anlaşmayı aktifleştir"}
                </button>
              )}
              {framework.status !== "cancelled" && (
                <button
                  type="button"
                  disabled={busy !== null}
                  onClick={() => call("cancel", "/cancel", { reason: decisionReason })}
                  className="rounded-lg border border-red-300 px-4 py-2 text-sm text-red-700 disabled:opacity-40"
                >
                  {busy === "cancel" ? "İptal ediliyor…" : "Anlaşmayı iptal et"}
                </button>
              )}
            </div>
            <p className="mt-2 text-xs text-gray-500">
              Anlaşma iptali ÖDENMİŞ partilere dokunmaz (geriye dönük tahsilat yok):
              onlar kendi akışında biter, iadeleri sipariş sayfasından yapılır.
            </p>
          </Card>

          {framework.customerNote && (
            <Card title="Müşteri notu">
              <p className="text-sm text-gray-700">{framework.customerNote}</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
