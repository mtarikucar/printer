"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { formatDate } from "@/lib/i18n/format";

export type PartnerKind = "manufacturer" | "painter";

export interface BankInfo {
  iban: string | null;
  accountHolder: string | null;
  bankName: string | null;
  /** Partnerin gönderdiği, henüz onaylanmamış yeni IBAN. */
  pendingIban: string | null;
  ibanReviewPending: boolean;
}

export interface EarningLine {
  orderId: string;
  orderNumber: string;
  grossKurus: number;
  commissionKurus: number;
  netKurus: number;
  status: string;
  /** Siparişin parası müşteriye iade edilmiş: bu hakediş ödenmez. */
  refunded: boolean;
  createdAt: string;
}

/**
 * Bir partnerin AÇIK hakedişleri, ödenebilir olan ve olmayan diye ayrılmış.
 *
 * `owedKurus`/`count` "Ödeme oluştur"un yaratacağı partinin TA KENDİSİDİR
 * (ortak kural, earning-claimable.ts); `refunded*` ise aynı kuyrukta duran ama
 * ödenmeyecek para. İkisi ayrı taşınır çünkü tek toplamda birleştirmek, ekranın
 * partnere "ödenmez" dediği tutarı admin'e "ödenecek" diye göstermekti.
 */
export interface OwedPartner {
  partnerId: string;
  name: string;
  owedKurus: number;
  count: number;
  refundedKurus: number;
  refundedCount: number;
  bank: BankInfo;
  earnings: EarningLine[];
  refundedEarnings: EarningLine[];
}

export interface PayoutRow {
  id: string;
  partnerId: string;
  name: string;
  totalKurus: number;
  earningCount: number;
  status: string;
  reference: string | null;
  adminEmail: string;
  requestedByPartner: boolean;
  createdAt: string;
  paidAt: string | null;
  bank: BankInfo;
  earnings: EarningLine[];
}

export interface PayoutTabData {
  owed: OwedPartner[];
  payouts: PayoutRow[];
}

const PARTNER: Record<
  PartnerKind,
  { tab: string; request: string; reviewHref: string; createUrl: (id: string) => string }
> = {
  manufacturer: {
    tab: "Üreticiler",
    request: "Üretici talebi",
    // Bekleyen IBAN değişikliği yalnızca KYC kuyruğunda görünür ve onaylanır;
    // üretici / boyacı listeleri yalnızca canlı IBAN'ı gösterir. #iban doğrudan
    // o bölüme götürür (sayfanın üstünde belge kuyruğu var).
    reviewHref: "/admin/kyc-queue#iban",
    createUrl: (id) => `/api/admin/manufacturers/${id}/payout`,
  },
  painter: {
    tab: "Boyacılar",
    request: "Boyacı talebi",
    // Aynı kuyruk boyacı IBAN değişikliklerini de listeler.
    reviewHref: "/admin/kyc-queue#iban",
    createUrl: (id) => `/api/admin/painters/${id}/payout`,
  },
};

const fmt = (k: number) =>
  `₺${(k / 100).toLocaleString("tr-TR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
// İstanbul saat dilimiyle (sunucu render'ı ile tarayıcı aynı günü yazsın).
const day = (iso: string) => formatDate(iso, "tr");

interface BankWarning {
  tone: "red" | "amber";
  text: string;
  review?: boolean;
}

// Para gönderilmeden önce görülmesi gerekenler. IBAN incelemesi bekleyen bir
// partnere eski IBAN'a transfer yapmak, partnerin "değiştirdim" dediği hesaba
// gitmeyen bir ödeme demektir — bu yüzden her tutarın yanında görünür.
function bankWarnings(b: BankInfo): BankWarning[] {
  const w: BankWarning[] = [];
  if (!b.iban) w.push({ tone: "red", text: "IBAN yok — transfer yapılamaz; partnerden IBAN isteyin." });
  if (b.ibanReviewPending) {
    w.push({
      tone: "amber",
      text: `IBAN değişikliği onay bekliyor${b.pendingIban ? ` (yeni: ${b.pendingIban})` : ""} — göndermeden önce inceleyin.`,
      review: true,
    });
  }
  if (b.iban && !b.accountHolder) w.push({ tone: "amber", text: "Hesap sahibi adı eksik." });
  return w;
}

function BankBlock({ bank, reviewHref }: { bank: BankInfo; reviewHref: string }) {
  const [copied, setCopied] = useState(false);
  const warnings = bankWarnings(bank);
  const copy = async () => {
    if (!bank.iban) return;
    try {
      await navigator.clipboard.writeText(bank.iban.replace(/\s+/g, ""));
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // Pano izni yoksa IBAN yine seçilebilir metin olarak duruyor.
    }
  };
  return (
    <div className="mt-2 space-y-1 text-xs text-gray-600">
      {bank.iban && (
        <p className="flex flex-wrap items-center gap-x-2">
          <span className="select-all font-mono text-gray-900">{bank.iban}</span>
          <button type="button" onClick={copy} className="text-indigo-600 hover:underline">
            {copied ? "Kopyalandı" : "Kopyala"}
          </button>
        </p>
      )}
      {(bank.accountHolder || bank.bankName) && (
        <p>{[bank.accountHolder, bank.bankName].filter(Boolean).join(" · ")}</p>
      )}
      {warnings.map((w) => (
        <p
          key={w.text}
          className={`rounded-md px-2 py-1 ${
            w.tone === "red" ? "bg-red-50 text-red-700" : "bg-amber-50 text-amber-800"
          }`}
        >
          {w.text}
          {w.review && (
            <>
              {" "}
              <Link href={reviewHref} className="font-medium underline">
                İncele
              </Link>
            </>
          )}
        </p>
      ))}
    </div>
  );
}

function EarningsDetails({ earnings, label }: { earnings: EarningLine[]; label: string }) {
  if (earnings.length === 0) return null;
  return (
    <details className="mt-2">
      <summary className="cursor-pointer select-none text-xs text-indigo-600 hover:underline">
        {label}
      </summary>
      <div className="mt-2 overflow-x-auto">
        <table className="w-full min-w-[480px] text-xs">
          <thead className="text-gray-500">
            <tr>
              <th className="py-1 pr-3 text-left font-medium">Sipariş</th>
              <th className="py-1 pr-3 text-left font-medium">Tahakkuk</th>
              <th className="py-1 pr-3 text-right font-medium">Brüt</th>
              <th className="py-1 pr-3 text-right font-medium">Hizmet bedeli</th>
              <th className="py-1 text-right font-medium">Net</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {earnings.map((e) => (
              <tr key={e.orderId}>
                <td className="py-1 pr-3">
                  <Link href={`/admin/orders/${e.orderId}`} className="font-mono text-indigo-600 hover:underline">
                    {e.orderNumber}
                  </Link>
                  {/* Parti kurulduktan SONRA da görünür kalır: bir hakedişin
                      iade olduğu, tam da parası gönderilmek üzereyken
                      okunabilmeli. */}
                  {e.refunded && (
                    <span className="ml-2 rounded-full bg-red-100 px-2 py-0.5 text-[11px] font-medium text-red-700">
                      İade edildi
                    </span>
                  )}
                </td>
                <td className="py-1 pr-3 text-gray-500">{day(e.createdAt)}</td>
                <td className="py-1 pr-3 text-right text-gray-500">{fmt(e.grossKurus)}</td>
                <td className="py-1 pr-3 text-right text-gray-500">−{fmt(e.commissionKurus)}</td>
                <td className="py-1 text-right font-medium text-gray-900">{fmt(e.netKurus)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </details>
  );
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-gray-500">{children}</h2>
  );
}

function Empty({ children }: { children: ReactNode }) {
  return (
    <div className="mb-8 rounded-xl border border-gray-200 bg-white p-8 text-center text-gray-500">
      {children}
    </div>
  );
}

// Who opened the payout: the partner's own request, or an admin, named by the
// email stored on the row. Shown on pending AND paid rows. The history used to
// drop it, so once paid a partner request and an admin batch looked the same.
function RequesterChip({ p, partnerLabel }: { p: PayoutRow; partnerLabel: string }) {
  if (p.requestedByPartner) {
    return (
      <span className="ml-2 rounded-full bg-sky-100 px-2 py-0.5 text-xs font-medium text-sky-700">
        {partnerLabel}
      </span>
    );
  }
  return (
    <span
      className="ml-2 rounded-full bg-gray-100 px-2 py-0.5 text-xs font-medium text-gray-600"
      title="Ödemeyi oluşturan admin"
    >
      {p.adminEmail ? `Admin · ${p.adminEmail}` : "Admin"}
    </span>
  );
}

export function PayoutsClient({
  initialTab,
  data,
}: {
  initialTab: PartnerKind;
  data: Record<PartnerKind, PayoutTabData>;
}) {
  const router = useRouter();
  const [tab, setTab] = useState<PartnerKind>(initialTab);
  const [busy, setBusy] = useState<string | null>(null);

  const d = data[tab];
  const cfg = PARTNER[tab];
  const pendingPayouts = d.payouts.filter((p) => p.status !== "paid");
  const paidPayouts = d.payouts.filter((p) => p.status === "paid");
  const waitingCount = (k: PartnerKind) =>
    data[k].owed.length + data[k].payouts.filter((p) => p.status !== "paid").length;

  const switchTab = (next: PartnerKind) => {
    setTab(next);
    // Sekme URL'de dursun: yenileme ya da paylaşılan bağlantı aynı sekmeye açılsın.
    window.history.replaceState(
      null,
      "",
      next === "painter" ? "/admin/payouts?tab=painter" : "/admin/payouts"
    );
  };

  // Bir ödeme partisinin içindeki iade edilmiş (ödenmemesi gereken) para.
  const refundedInPayout = (p: PayoutRow) => {
    const rows = p.earnings.filter((e) => e.refunded);
    return rows.length
      ? { count: rows.length, kurus: rows.reduce((a, e) => a + e.netKurus, 0) }
      : null;
  };

  // Adım 1 — para GÖNDERMEZ; bekleyen hakedişleri tek bir bekleyen ödemede toplar.
  const createPayout = async (o: OwedPartner) => {
    const warn = bankWarnings(o.bank).map((w) => `- ${w.text}`);
    // Onay kutusunda yazan rakam ile oluşan parti artık aynı; aradaki farkın
    // nereye gittiği de burada yazar, sessizce düşmez.
    if (o.refundedCount > 0) {
      warn.push(
        `- İade edilen ${o.refundedCount} sipariş (${fmt(o.refundedKurus)}) bu ödemeye GİRMEZ.`
      );
    }
    const msg =
      `${o.name} için ${fmt(o.owedKurus)} tutarında ödeme (${o.count} sipariş) oluşturulsun mu?` +
      (warn.length ? `\n\nDikkat:\n${warn.join("\n")}` : "") +
      `\n\nBu adım parayı göndermez. Transferi yaptıktan sonra "Ödendi işaretle"ye basın.`;
    if (!confirm(msg)) return;
    setBusy(`create-${o.partnerId}`);
    try {
      const res = await fetch(cfg.createUrl(o.partnerId), { method: "POST" });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Ödeme oluşturulamadı");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  // Adım 2 — banka transferi yapıldıktan sonra.
  const markPaid = async (p: PayoutRow) => {
    // Eski kurala göre kurulmuş partilerde iade edilmiş hakediş bulunabilir;
    // "Ödendi" onu `paid` yapar ve para gerçekten ödenmiş sayılır.
    const refunded = refundedInPayout(p);
    if (
      refunded &&
      !confirm(
        `${p.name} — bu ödemedeki ${refunded.count} siparişin parası müşteriye iade edilmiş (${fmt(refunded.kurus)}). Bu tutar ödenmemeli. Yine de ödendi işaretlensin mi?`
      )
    ) {
      return;
    }
    if (
      p.bank.ibanReviewPending &&
      !confirm(
        `${p.name} için IBAN değişikliği onay bekliyor. Transferi kayıtlı (onaylı) IBAN'a yaptığınızdan emin misiniz?`
      )
    ) {
      return;
    }
    const reference = prompt(`${p.name} — ${fmt(p.totalKurus)}\nBanka referansı (opsiyonel):`);
    // İptal = işaretleme yok (eskiden iptal de "ödendi" yazıyordu).
    if (reference === null) return;
    setBusy(`paid-${p.id}`);
    try {
      const res = await fetch(`/api/admin/payouts/${p.id}/mark-paid`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ reference, kind: tab }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "İşaretlenemedi");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  /**
   * Partinin ARKASINDA duran para: "Ödendi" işaretlendiğinde gerçekten
   * kapanacak satırların toplamı. Çevrilmiş (iade/clawback) satırlar hariç,
   * çünkü onlar `paid` olmaz — uç de tam bu kümeyi karşılaştırır, böylece
   * ekranın uyardığı hâl ile ucun reddettiği hâl AYNIDIR.
   */
  const heldBy = (p: PayoutRow) => {
    const rows = p.earnings.filter((e) => e.status !== "reversed");
    return { count: rows.length, kurus: rows.reduce((a, e) => a + e.netKurus, 0) };
  };

  /**
   * Parti iddia ettiği parayı tutuyor mu?
   *
   * KAPANAN HATA: uyarı `p.earnings.length > 0` koşuluna bağlıydı, yani tam da
   * EN TEHLİKELİ hâlde susuyordu — bütün satırları eşzamanlı başka bir partiye
   * kaçmış bir parti ("6 sipariş · ₺12.600,00" yazan ama arkasında tek satır
   * olmayan hayalet) hiçbir işaret göstermeden, yanındaki gerçek partiyle
   * birebir aynı görünüyordu. Uyuşmazlığı ÖLÇMEYİ imkânsız kılan durum, en az
   * uyuşmazlık kadar açık yazılmalı.
   */
  const payoutMismatch = (p: PayoutRow) => {
    const held = heldBy(p);
    return held.kurus !== p.totalKurus || held.count !== p.earningCount ? held : null;
  };
  /** Parti hiç hak ediş tutmuyor: ödenemez, ama kuyruktan silinebilir. */
  const holdsNothing = (p: PayoutRow) => heldBy(p).count === 0;

  const mismatchText = (p: PayoutRow, held: { count: number; kurus: number }) =>
    held.count === 0
      ? `Bu parti ${p.earningCount} sipariş · ${fmt(p.totalKurus)} diyor ama ARKASINDA TEK BİR HAK EDİŞ YOK. Eşzamanlı bir ödeme oluşturma sırasında satırlar başka bir partiye girmiş olabilir: TRANSFER YAPMAYIN. Ödendi işaretlenemez; partnerin güncel hak edişlerine bakıp boş partiyi silin.`
      : `Bu parti ${p.earningCount} sipariş · ${fmt(p.totalKurus)} diyor ama arkasında ${held.count} sipariş · ${fmt(held.kurus)} var. Tutarsız parti ödendi işaretlenemez; siparişleri aşağıdan kontrol edin.`;

  // Yalnız BOŞ ve bekleyen partiyi siler; uç de aynı kuralı uygular.
  const deleteEmptyPayout = async (p: PayoutRow) => {
    if (
      !confirm(
        `${p.name} — bu parti hiçbir hak ediş tutmuyor (üzerinde ${p.earningCount} sipariş · ${fmt(p.totalKurus)} yazıyor). Parti kuyruktan silinsin mi?\n\nHak edişler etkilenmez: ödenmemiş olanlar yeniden partilenebilir. Silinen parti geri alınamaz.`
      )
    ) {
      return;
    }
    setBusy(`delete-${p.id}`);
    try {
      const res = await fetch(`/api/admin/payouts/${p.id}`, {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: tab }),
      });
      if (!res.ok) {
        const j = await res.json().catch(() => ({}));
        alert(j.error || "Parti silinemedi");
        return;
      }
      router.refresh();
    } finally {
      setBusy(null);
    }
  };

  return (
    <div className="max-w-5xl p-4 sm:p-8">
      <h1 className="mb-1 text-2xl font-bold text-gray-900">Ödemeler (Payout)</h1>
      <p className="mb-6 text-sm text-gray-500">
        İki adım: önce ödeme oluşturun (bekleyen hak edişler tek ödemede toplanır), banka
        transferini yaptıktan sonra &quot;Ödendi işaretle&quot;.
      </p>

      <div className="mb-6 flex gap-2 border-b border-gray-200">
        {(Object.keys(PARTNER) as PartnerKind[]).map((k) => {
          const n = waitingCount(k);
          return (
            <button
              key={k}
              type="button"
              onClick={() => switchTab(k)}
              className={`-mb-px border-b-2 px-4 py-2 text-sm font-medium ${
                tab === k
                  ? "border-indigo-600 text-indigo-700"
                  : "border-transparent text-gray-500 hover:text-gray-800"
              }`}
            >
              {PARTNER[k].tab}
              {n > 0 && (
                <span className="ml-2 rounded-full bg-amber-100 px-2 py-0.5 text-xs text-amber-800">{n}</span>
              )}
            </button>
          );
        })}
      </div>

      <SectionTitle>1 · Ödeme bekleyen hak edişler</SectionTitle>
      {d.owed.length === 0 ? (
        <Empty>Bekleyen hak ediş yok.</Empty>
      ) : (
        <div className="mb-8 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {d.owed.map((o) => (
            <div key={o.partnerId} className="px-4 py-3">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-gray-900">{o.name}</p>
                  <p className="text-xs text-gray-500">{o.count} sipariş</p>
                  <BankBlock bank={o.bank} reviewHref={cfg.reviewHref} />
                </div>
                <div className="flex items-center gap-4">
                  <span className="font-semibold text-gray-900">{fmt(o.owedKurus)}</span>
                  {o.count > 0 ? (
                    <button
                      type="button"
                      onClick={() => createPayout(o)}
                      disabled={busy === `create-${o.partnerId}`}
                      className="rounded-lg bg-indigo-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-indigo-700 disabled:bg-gray-400"
                    >
                      {busy === `create-${o.partnerId}` ? "…" : "Ödeme oluştur"}
                    </button>
                  ) : (
                    // Ödenebilir satır yok (kuyrukta yalnız iade hakedişi var).
                    // Düğme yine de sunuluyordu ve servis 400 ile reddediyordu:
                    // ölü düğme. Sebebi yazılı olarak duruyor.
                    <span className="rounded-lg bg-gray-100 px-4 py-1.5 text-sm text-gray-500">
                      Ödenecek hak ediş yok
                    </span>
                  )}
                </div>
              </div>
              {o.refundedCount > 0 && (
                <p className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
                  İade edilen {o.refundedCount} sipariş · {fmt(o.refundedKurus)} — ödenmez, ödeme
                  oluşturduğunuzda partiye girmez. Partnerin kendi ekranı da bu tutarı talep
                  edilebilir saymıyor.
                </p>
              )}
              <EarningsDetails earnings={o.earnings} label="Siparişleri göster" />
              <EarningsDetails
                earnings={o.refundedEarnings}
                label="İade edilen siparişleri göster"
              />
            </div>
          ))}
        </div>
      )}

      <SectionTitle>2 · Transfer bekleyen ödemeler</SectionTitle>
      {pendingPayouts.length === 0 ? (
        <Empty>Transfer bekleyen ödeme yok.</Empty>
      ) : (
        <div className="mb-8 divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {pendingPayouts.map((p) => {
            const mismatch = payoutMismatch(p);
            const refunded = refundedInPayout(p);
            return (
              <div key={p.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="font-medium text-gray-900">
                      {p.name}
                      <RequesterChip p={p} partnerLabel={cfg.request} />
                    </p>
                    <p className="text-xs text-gray-500">
                      {day(p.createdAt)} · {p.earningCount} sipariş
                    </p>
                    <BankBlock bank={p.bank} reviewHref={cfg.reviewHref} />
                    {mismatch !== null && (
                      <p
                        role="alert"
                        className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700"
                      >
                        {mismatchText(p, mismatch)}
                      </p>
                    )}
                    {mismatch === null && holdsNothing(p) && (
                      // Tutarlı ama BOŞ parti: bütün hak edişleri geri alınmış
                      // (iade). Ödenecek bir şey yok; kuyruğu tıkamasın.
                      <p className="mt-1 rounded-md bg-amber-50 px-2 py-1 text-xs text-amber-800">
                        Bu parti boş: içindeki hak edişlerin tamamı geri alınmış. Ödenecek tutar
                        yok, partiyi kuyruktan silebilirsiniz.
                      </p>
                    )}
                    {refunded !== null && (
                      <p className="mt-1 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700">
                        Bu ödemedeki {refunded.count} siparişin parası müşteriye iade edilmiş:{" "}
                        {fmt(refunded.kurus)} ödenmemeli. Transferi yapmadan önce tutarı düşün ve
                        partnere bilgi verin.
                      </p>
                    )}
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-semibold text-gray-900">{fmt(p.totalKurus)}</span>
                    {/* Ekran, ucun REDDEDECEĞİ denetimi sunmaz: tuttuğu parayı
                        söylemeyen ya da hiç hak ediş tutmayan parti için tek
                        anlamlı iş, partiyi kuyruktan kaldırmaktır. */}
                    {mismatch === null && !holdsNothing(p) ? (
                      <button
                        type="button"
                        onClick={() => markPaid(p)}
                        disabled={busy === `paid-${p.id}`}
                        className="rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-emerald-700 disabled:bg-gray-400"
                      >
                        {busy === `paid-${p.id}` ? "…" : "Ödendi işaretle"}
                      </button>
                    ) : holdsNothing(p) ? (
                      <button
                        type="button"
                        onClick={() => deleteEmptyPayout(p)}
                        disabled={busy === `delete-${p.id}`}
                        className="rounded-lg border border-red-300 bg-white px-3 py-1.5 text-xs font-medium text-red-700 hover:bg-red-50 disabled:text-gray-400"
                      >
                        {busy === `delete-${p.id}` ? "…" : "Boş partiyi sil"}
                      </button>
                    ) : (
                      <span className="rounded-lg bg-gray-100 px-3 py-1.5 text-xs text-gray-500">
                        Ödendi işaretlenemez
                      </span>
                    )}
                  </div>
                </div>
                <EarningsDetails earnings={p.earnings} label="Siparişleri göster" />
              </div>
            );
          })}
        </div>
      )}

      <SectionTitle>Ödeme geçmişi</SectionTitle>
      {paidPayouts.length === 0 ? (
        <Empty>Henüz ödeme yok.</Empty>
      ) : (
        <div className="divide-y divide-gray-100 rounded-xl border border-gray-200 bg-white">
          {paidPayouts.map((p) => (
            <div key={p.id} className="px-4 py-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="font-medium text-gray-900">
                    {p.name}
                    <RequesterChip p={p} partnerLabel={cfg.request} />
                  </p>
                  <p className="text-xs text-gray-500">
                    {day(p.createdAt)} · {p.earningCount} sipariş
                    {p.paidAt ? ` · ödendi ${day(p.paidAt)}` : ""}
                    {p.reference ? ` · Ref: ${p.reference}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <span className="font-semibold text-gray-900">{fmt(p.totalKurus)}</span>
                  <span className="rounded-full bg-emerald-100 px-2 py-0.5 text-xs font-medium text-emerald-700">
                    Ödendi
                  </span>
                </div>
              </div>
              {/* Geçmişte de susmaz: düzeltmeden ÖNCE ödenmiş bir hayalet parti
                  ("ödendi" yazan ama arkasında hak ediş olmayan) yalnız burada
                  görünür ve muhasebe ile partnerin ekranı ancak böyle
                  uzlaştırılabilir. */}
              {payoutMismatch(p) !== null && (
                <p
                  role="alert"
                  className="mt-2 rounded-md bg-red-50 px-2 py-1 text-xs text-red-700"
                >
                  {mismatchText(p, heldBy(p))} Bu parti ödendi işaretlenmiş: gerçekten gönderilen
                  tutarı banka kaydından doğrulayın.
                </p>
              )}
              <EarningsDetails earnings={p.earnings} label="Siparişleri göster" />
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
