"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  DISPUTE_CATEGORY_LABELS_TR, DISPUTE_STATUS_LABELS_TR, normalizeResolveDisputeInput,
  type DisputeDecisionResult, type DisputeDecisionView, type DisputeStatus, type ResolveDisputeInput,
} from "@/lib/config/dispute-resolution";
import { refundResponseAllowsNewIntent } from "@/lib/config/order-refund";
import { buildRefundEntryInput, emptyRefundEntry, RefundEntryFields, refundReceiptMatchesInput } from "@/components/admin/refund-entry-fields";

export interface DisputeRow {
  id: string; orderId: string; orderNumber: string | null;
  category: string; description: string; createdAt: string;
  status: DisputeStatus; resolution: string | null; resolvedAt: string | null;
  decisionOperationKey: string | null; refundRecordId: string | null;
  refund: { cashKurus: number; giftKurus: number } | null;
}
const STORAGE_KEY = "dispute-decision-intent";
const money = (value: number) => (value / 100).toLocaleString("tr-TR", { style: "currency", currency: "TRY" });
const dateText = (value: string) => new Date(value).toLocaleString("tr-TR");
const categoryLabel = (category: string) => DISPUTE_CATEGORY_LABELS_TR[category as keyof typeof DISPUTE_CATEGORY_LABELS_TR] ?? "Eski kategori";

function decisionReceiptMatchesInput(value: unknown, input: ResolveDisputeInput, knownOrderId?: string): value is DisputeDecisionResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const receipt = value as Record<string, unknown>;
  if (receipt.ok !== true || receipt.disputeId !== input.disputeId || receipt.operationKey !== input.operationKey
    || typeof receipt.orderId !== "string" || receipt.orderId.length !== 36
    || !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(receipt.orderId)
    || (knownOrderId !== undefined && receipt.orderId !== knownOrderId)
    || receipt.status !== (input.action === "resolve" ? "resolved" : "rejected")
    || receipt.resolution !== input.resolution || typeof receipt.replayed !== "boolean"
    || typeof receipt.resolvedAt !== "string" || !Number.isFinite(Date.parse(receipt.resolvedAt))
    || new Date(receipt.resolvedAt).toISOString() !== receipt.resolvedAt
    || typeof receipt.decisionNotificationState !== "string"
    || !["pending", "delivered", "not_required"].includes(receipt.decisionNotificationState)) return false;
  if (!input.refund) return receipt.refund === null;
  return input.refund.allocations.length === 1 && receipt.orderId === input.refund.allocations[0].orderId
    && refundReceiptMatchesInput(receipt.refund, { ...input.refund, operationKey: input.operationKey, mode: "actual" });
}

function RefundSummary({ row }: { row: Pick<DisputeRow, "decisionOperationKey" | "refundRecordId" | "refund"> }) {
  if (row.refund) return <p className="mt-2 text-sm">Bu kararla kaydedilen iade: nakit {money(row.refund.cashKurus)} · hediye kartı {money(row.refund.giftKurus)}.</p>;
  if (row.refundRecordId) return <p className="mt-2 text-sm text-amber-800">Karara bağlı iade tutarı okunamadı. Siparişin iade kayıtlarını kontrol edin.</p>;
  return <p className="mt-2 text-sm text-gray-500">{row.decisionOperationKey ? "Bu kararla yeni iade kaydı oluşturulmadı." : "Eski kararın iade tutarı bu kayıttan doğrulanamıyor."}</p>;
}

function DecisionEditor({ view, disabled, onSubmit }: {
  view: DisputeDecisionView; disabled: boolean; onSubmit: (input: ResolveDisputeInput) => Promise<void>;
}) {
  const [resolution, setResolution] = useState("");
  const [action, setAction] = useState<"resolve" | "reject">("resolve");
  const [includeRefund, setIncludeRefund] = useState(false);
  const [values, setValues] = useState(emptyRefundEntry);
  const [error, setError] = useState<string | null>(null);
  const orderId = view.dispute.orderId;
  const sibling = view.refundView?.siblings.find(row => row.orderId === orderId);
  const canRefund = !view.refundReadUnavailable && !!view.refundView?.canRecord && !!sibling && !sibling.legacyUnverified
    && sibling.remainingCashKurus !== null && sibling.remainingGiftKurus !== null
    && sibling.remainingCashKurus + sibling.remainingGiftKurus > 0;

  async function submit() {
    if (disabled || view.dispute.status !== "open") return;
    setError(null);
    try {
      const operationKey = crypto.randomUUID();
      let refund: ResolveDisputeInput["refund"];
      if (includeRefund) {
        if (action !== "resolve" || !canRefund || !view.refundView) throw new Error("Bu karar için iade girişi kullanılamıyor. İade seçimini kaldırarak yalnız karar kaydedebilirsiniz.");
        const entry = buildRefundEntryInput(orderId, view.refundView, values, operationKey, "actual");
        refund = { expectedFingerprint: entry.expectedFingerprint, allocations: entry.allocations,
          reason: entry.reason, ...(entry.cashEvidence ? { cashEvidence: entry.cashEvidence } : {}) };
      }
      const input = normalizeResolveDisputeInput({ disputeId: view.dispute.id, operationKey,
        expectedDecisionFingerprint: view.expectedDecisionFingerprint, action, resolution, ...(refund ? { refund } : {}) });
      const cash = refund?.allocations.reduce((sum, row) => sum + row.cashKurus, 0) ?? 0;
      const gift = refund?.allocations.reduce((sum, row) => sum + row.giftKurus, 0) ?? 0;
      if (!window.confirm(refund
        ? `Karar ve gerçekleşen nakit iade ${money(cash)} birlikte kaydedilecek; hediye kartına ${money(gift)} geri yüklenecek. Bu panel banka veya PayTR transferi yapmaz. Devam edilsin mi?`
        : "Karar kaydedilecek. Bu kararla yeni iade kaydı oluşturulmaz; sipariş iptal edilmez. Devam edilsin mi?")) return;
      await onSubmit(input);
    } catch (e) { setError(e instanceof Error ? e.message : "Karar bilgileri doğrulanamadı."); }
  }

  const linked = view.refundView?.history.find(row => row.refundId === view.dispute.refundRecordId && row.kind === "refund");
  const allocation = linked?.allocations.find(row => row.orderId === orderId);
  return <section className="rounded-xl border border-indigo-200 bg-white p-5">
    <div className="flex flex-wrap justify-between gap-2"><h2 className="font-semibold">Anlaşmazlık kararı</h2><Link className="text-sm text-indigo-700 underline" href={`/admin/orders/${orderId}`}>{view.dispute.orderNumber ?? "Siparişi aç"}</Link></div>
    <p className="mt-2 text-xs text-gray-500">{categoryLabel(view.dispute.category)} · {DISPUTE_STATUS_LABELS_TR[view.dispute.status]}</p>
    <p className="mt-2 whitespace-pre-wrap text-sm">{view.dispute.description}</p>
    {view.dispute.status !== "open" ? <div className="mt-3">
      <p className="whitespace-pre-wrap text-sm">{view.dispute.resolution ?? "Eski kayıtta karar gerekçesi bulunmuyor."}</p>
      <p className="mt-1 text-xs text-gray-500">{view.dispute.resolvedAt ? `Karar tarihi: ${dateText(view.dispute.resolvedAt)}` : "Karar tarihi kayıtlı değil."}</p>
      <RefundSummary row={{ ...view.dispute, refund: allocation ?? null }} />
    </div> : <fieldset disabled={disabled} className="mt-4 space-y-4 disabled:opacity-60">
      <label className="block text-sm">Karar<select value={action} onChange={e => { setAction(e.target.value as "resolve" | "reject"); setIncludeRefund(false); }} className="mt-1 block w-full rounded-lg border p-2">
        <option value="resolve">Çözüm kaydet</option><option value="reject">İncelendi — işlem yok</option>
      </select></label>
      <label className="block text-sm">Karar gerekçesi<textarea value={resolution} onChange={e => setResolution(e.target.value)} minLength={10} maxLength={2000} rows={3} className="mt-1 w-full rounded-lg border p-2" /><span className="text-xs text-gray-500">10–2000 karakter. Müşteri bu gerekçeyi görecek.</span></label>
      {view.refundReadUnavailable && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{view.refundReadUnavailable} Yalnız karar kaydetmeye devam edebilirsiniz.</p>}
      {!canRefund && !view.refundReadUnavailable && <p className="text-xs text-amber-800">{view.refundView?.blockedReason ?? "Bu sipariş için doğrulanmış kalan iade tutarı yok. Yalnız karar kaydedebilirsiniz."}</p>}
      {action === "resolve" && <label className="block text-sm"><input type="checkbox" checked={includeRefund} disabled={disabled || !canRefund} onChange={e => setIncludeRefund(e.target.checked)} className="mr-2" />Kararla birlikte gerçekleşen iade kaydı oluştur</label>}
      {includeRefund && view.refundView && <div className="space-y-3 rounded-lg border border-red-200 p-3">
        <p className="text-xs text-gray-600">Bu siparişte kalan: nakit {money(sibling!.remainingCashKurus!)} · hediye kartı {money(sibling!.remainingGiftKurus!)}.</p>
        <RefundEntryFields orderId={orderId} view={view.refundView} values={values} onChange={setValues} mode="actual" singleOrderOnly disabled={disabled} />
      </div>}
      {!includeRefund && <p className="text-xs text-gray-600">Bu kararla yeni iade kaydı oluşturulmaz. “İşlem yok” kararı siparişi iptal etmez.</p>}
      {error && <p role="alert" className="text-sm text-red-800">{error}</p>}
      <button type="button" onClick={submit} disabled={disabled || resolution.trim().length < 10 || (includeRefund && values.reason.trim().length < 10)} className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white disabled:bg-gray-300">{includeRefund ? "Kararı ve iadeyi birlikte kaydet" : "Kararı kaydet"}</button>
    </fieldset>}
  </section>;
}

export function DisputesClient({ disputes, status = "open", page = 1, hasNext = false, readError, warning }: {
  disputes: DisputeRow[]; status?: DisputeStatus; page?: number; hasNext?: boolean; readError?: string; warning?: string;
}) {
  const router = useRouter();
  const inFlight = useRef(false);
  const [busy, setBusy] = useState(false);
  const [storageReady, setStorageReady] = useState(false);
  const [pending, setPending] = useState<ResolveDisputeInput | null>(null);
  const [view, setView] = useState<DisputeDecisionView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.resolve().then(() => {
      if (!active) return;
      try {
        const saved = sessionStorage.getItem(STORAGE_KEY);
        if (saved) setPending(normalizeResolveDisputeInput(JSON.parse(saved)));
        setStorageReady(true);
      } catch { setError("Bekleyen karar kaydı okunamadı. Yeni işlem göndermeden önce tarayıcıdaki kaydı kontrol edin."); }
    });
    return () => { active = false; };
  }, []);

  async function read(id: string) {
    if (inFlight.current) return;
    inFlight.current = true; setBusy(true); setError(null); setView(null);
    try {
      const response = await fetch(`/api/admin/disputes/${id}/resolve`, { cache: "no-store" });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Anlaşmazlık bilgileri okunamadı.");
      if (data.dispute?.id !== id || typeof data.expectedDecisionFingerprint !== "string") throw new Error("Anlaşmazlık yanıtı doğrulanamadı.");
      setView(data as DisputeDecisionView);
    } catch (e) { setError(e instanceof Error ? e.message : "Anlaşmazlık bilgileri okunamadı."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  async function send(input: ResolveDisputeInput) {
    if (inFlight.current || !storageReady) return;
    inFlight.current = true; setBusy(true); setError(null); setNotice(null);
    try {
      // Persist the ROOT command before POST. It remains visible independently
      // of URL filters and rows, including when a lost response closed its row.
      sessionStorage.setItem(STORAGE_KEY, JSON.stringify(input));
      setPending(input);
      const response = await fetch(`/api/admin/disputes/${input.disputeId}/resolve`, {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(input),
      });
      const data = await response.json();
      if (!response.ok) {
        if (response.status === 409 && data.code === "already_closed") {
          // A bare refusal cannot discard an uncertain earlier command. Verify
          // the current closed decision belongs to another operation first.
          const latestResponse = await fetch(`/api/admin/disputes/${input.disputeId}/resolve`, { cache: "no-store" });
          const latest = await latestResponse.json();
          const decision = latest.dispute;
          if (latestResponse.ok && decision?.id === input.disputeId
            && ["resolved", "rejected"].includes(decision.status)
            && (decision.decisionOperationKey === null || (typeof decision.decisionOperationKey === "string"
              && decision.decisionOperationKey.length === 36
              && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(decision.decisionOperationKey)
              && decision.decisionOperationKey.toLowerCase() !== input.operationKey.toLowerCase()))
            && typeof latest.expectedDecisionFingerprint === "string" && /^[0-9a-f]{64}$/.test(latest.expectedDecisionFingerprint)) {
            sessionStorage.removeItem(STORAGE_KEY); setPending(null); setView(latest as DisputeDecisionView);
            setNotice(`Anlaşmazlık daha önce başka bir kararla kapatılmış. Bu gönderim uygulanmadı; mevcut karar aşağıda gösteriliyor.${input.refund ? " Bu gönderimin iadesi kaydedilmedi. Bankadan/PayTR’den gerçekten dönen tutar varsa siparişin İadeler bölümünden kaydedin." : ""}`);
            router.refresh();
            return;
          }
          throw new Error("Kapalı karar bu işlemden bağımsız olarak doğrulanamadı. Bekleyen işlem numarası korundu; aynı kararın sonucunu yeniden kontrol edin.");
        }
        if (refundResponseAllowsNewIntent(response.status, data.code)) {
          sessionStorage.removeItem(STORAGE_KEY); setPending(null); setView(null);
        }
        throw new Error(data.error || "Karar sonucu doğrulanamadı. Aynı işlem numarasıyla yeniden kontrol edin.");
      }
      const knownOrderId = input.refund?.allocations[0]?.orderId
        ?? (view?.dispute.id === input.disputeId ? view.dispute.orderId : disputes.find(row => row.id === input.disputeId)?.orderId);
      if (!decisionReceiptMatchesInput(data, input, knownOrderId)) {
        throw new Error("Karar yanıtı doğrulanamadı. İşlem numarası korundu; aynı işlem numarasıyla sonucu yeniden kontrol edin.");
      }
      const result = data;
      // Decision-only commands carry no order ID. After a reload outside the
      // list, bind that receipt to the authenticated current decision as well.
      if (!knownOrderId) {
        const latestResponse = await fetch(`/api/admin/disputes/${input.disputeId}/resolve`, { cache: "no-store" });
        const latest = await latestResponse.json();
        if (!latestResponse.ok || latest.dispute?.id !== input.disputeId || latest.dispute.orderId !== result.orderId
          || latest.dispute.decisionOperationKey !== input.operationKey || latest.dispute.status !== result.status
          || latest.dispute.resolution !== result.resolution) {
          throw new Error("Kararın sipariş bağlantısı doğrulanamadı. İşlem numarası korundu; aynı kararın sonucunu yeniden kontrol edin.");
        }
      }
      sessionStorage.removeItem(STORAGE_KEY); setPending(null); setView(null);
      setNotice(`${result.replayed ? "Önceki karar bulundu; ikinci işlem yapılmadı." : "Karar kaydedildi."} ${result.refund
        ? `Gerçekleşen iade: nakit ${money(result.refund.cashKurus)} · hediye kartı ${money(result.refund.giftKurus)}.`
        : "Bu kararla yeni iade kaydı oluşturulmadı."}${result.decisionNotificationState === "pending" ? " Müşteri e-postası sırada; kararı yeniden girmeyin." : ""}${result.refund?.warning ? ` ${result.refund.warning}` : ""}`);
      router.refresh();
    } catch (e) { setError(e instanceof Error ? e.message : "Karar sonucu doğrulanamadı. Aynı işlem numarasıyla sonucu yeniden kontrol edin."); }
    finally { inFlight.current = false; setBusy(false); }
  }

  return <div className="max-w-4xl space-y-5 p-4 sm:p-8">
    <h1 className="text-2xl font-bold text-gray-900">Anlaşmazlıklar</h1>
    <nav aria-label="Anlaşmazlık durumu" className="flex flex-wrap gap-2">{(Object.keys(DISPUTE_STATUS_LABELS_TR) as DisputeStatus[]).map(tab => <Link key={tab} href={`/admin/disputes?status=${tab}`} aria-current={status === tab ? "page" : undefined} className={`rounded-lg border px-4 py-2 text-sm ${status === tab ? "bg-indigo-700 text-white" : "bg-white text-gray-700"}`}>{DISPUTE_STATUS_LABELS_TR[tab]}</Link>)}</nav>
    {readError && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{readError} <Link href="/admin/disputes?status=open" className="underline">Açık kayıtları yeniden yükle</Link></p>}
    {warning && <p role="alert" className="rounded-lg bg-amber-50 p-3 text-sm text-amber-900">{warning}</p>}
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-800">{error}</p>}
    {notice && <p role="status" className="rounded-lg bg-emerald-50 p-3 text-sm text-emerald-900">{notice}</p>}
    {pending && <section className="space-y-2 rounded-lg border border-amber-300 bg-amber-50 p-4 text-sm text-amber-900">
      <h2 className="font-semibold">Önceki kararın sonucu henüz doğrulanmadı</h2>
      <p>Aynı işlem numarasıyla sonucu kontrol edin; yeni bir karar veya iade girmeyin. Bu kayıt seçili sekmede görünmese de bekleyen işlem korunur.</p>
      <p className="break-all text-xs">İşlem: {pending.operationKey} · Anlaşmazlık: {pending.disputeId}</p>
      <p className="whitespace-pre-wrap">Gönderilen gerekçe: {pending.resolution}</p>
      <div className="flex flex-wrap gap-2"><button type="button" disabled={busy} onClick={() => send(pending)} className="rounded-lg border border-amber-500 px-3 py-2 font-semibold">Aynı kararın sonucunu kontrol et</button><button type="button" disabled={busy} onClick={() => read(pending.disputeId)} className="rounded-lg border px-3 py-2">Güncel kararı görüntüle</button></div>
    </section>}
    {view && <DecisionEditor key={`${view.dispute.id}:${view.expectedDecisionFingerprint}`} view={view} disabled={busy || !storageReady || !!pending} onSubmit={send} />}
    {!readError && disputes.length === 0 && <p className="rounded-xl border bg-white p-8 text-center text-gray-500">Bu durumda anlaşmazlık kaydı yok.</p>}
    {disputes.map(row => <article key={row.id} className="rounded-xl border border-gray-200 bg-white p-5">
      <div className="flex flex-wrap justify-between gap-2"><Link href={`/admin/orders/${row.orderId}`} className="font-mono text-sm text-indigo-700 underline">{row.orderNumber ?? "Sipariş numarası okunamadı — siparişi aç"}</Link><span className="text-xs text-gray-500">{dateText(row.createdAt)}</span></div>
      <p className="mt-2 text-xs text-gray-500">{categoryLabel(row.category)} · {DISPUTE_STATUS_LABELS_TR[row.status]}</p>
      <p className="mt-2 whitespace-pre-wrap text-sm text-gray-800">{row.description}</p>
      {row.status === "open" ? <button type="button" disabled={busy || !storageReady || !!pending} onClick={() => read(row.id)} className="mt-3 rounded-lg border px-3 py-2 text-sm font-semibold disabled:opacity-50">Karar formunu aç</button> : <div className="mt-3 border-t pt-3">
        <p className="whitespace-pre-wrap text-sm">{row.resolution ?? "Eski kayıtta karar gerekçesi bulunmuyor."}</p>
        <p className="mt-1 text-xs text-gray-500">{row.resolvedAt ? `Karar tarihi: ${dateText(row.resolvedAt)}` : "Karar tarihi kayıtlı değil."}</p>
        <RefundSummary row={row} />
      </div>}
    </article>)}
    <nav aria-label="Anlaşmazlık sayfaları" className="flex items-center justify-between gap-3 text-sm">
      <span>{page > 1 && <Link href={`/admin/disputes?status=${status}&page=${page - 1}`} className="rounded-lg border bg-white px-3 py-2">Önceki sayfa</Link>}</span>
      <span className="text-gray-500">Sayfa {page}</span>
      <span>{hasNext && <Link href={`/admin/disputes?status=${status}&page=${page + 1}`} className="rounded-lg border bg-white px-3 py-2">Sonraki sayfa</Link>}</span>
    </nav>
  </div>;
}
