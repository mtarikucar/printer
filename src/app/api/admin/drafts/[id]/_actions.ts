import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "@/lib/db";
import { orderDrafts, orderItems, orders, workshopParticipants, adminDraftActions } from "@/lib/db/schema";
import { DRAFT_INPUT_ERROR, draftActionSchema, draftLinesUpdate, draftPermissions, type DraftAction } from "./_policy";
import type { EmailJobData } from "@/lib/queue/queues";

export class DraftActionError extends Error {
  constructor(message: string, public status = 409) { super(message); }
}
export async function applyDraftAction(
  id: string, input: DraftAction, adminEmail: string,
  enqueue: (data: EmailJobData) => Promise<unknown> = async (data) => {
    const { getEmailQueue } = await import("@/lib/queue/queues");
    return getEmailQueue().add("send-email", data);
  },
  schedule: (draftId: string, reference: string, deadline: Date) => Promise<unknown> = async (draftId, reference, deadline) => {
    const { getPaymentDeadlineQueue, havaleExpireJobId } = await import("@/lib/queue/queues");
    // Stamp the intended deadline: if the DB transaction rolls back after
    // Redis accepts this job, the worker MUST discard the orphan job.
    const data = { draftId, reference, type: "havale_expire" as const, expectedDeadline: deadline.toISOString() };
    return getPaymentDeadlineQueue().add("havale_expire", data, {
      jobId: `${havaleExpireJobId(draftId)}-extended-${deadline.getTime()}`,
      delay: Math.max(0, deadline.getTime() - Date.now()),
    });
  },
) {
  const parsed = draftActionSchema.safeParse(input);
  if (!parsed.success) throw new DraftActionError(DRAFT_INPUT_ERROR, 400);
  const action = parsed.data;
  const result = await db.transaction(async (tx) => {
    await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
    // Shared with payment-deadline.worker.ts; acquired BEFORE the draft row.
    // The worker holds only this advisory lock while expireDraft acquires its
    // own row lock. This closes the deadline reread → expire race.
    await tx.execute(sql`select pg_advisory_xact_lock(hashtextextended(${`draft-deadline:${id}`}, 0))`);
    // Same row and lock order as promoteDraftToOrder. A promotion that wins
    // commits first; after waiting we inspect its NEW status before writing.
    const [draft] = await tx.select().from(orderDrafts).where(eq(orderDrafts.id, id)).for("update");
    if (!draft) throw new DraftActionError("Taslak bulunamadı.", 404);
    const [promoted] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.draftId, id)).limit(1);
    if (promoted) throw new DraftActionError("Taslak siparişe dönüştürülmüş; sipariş ekranını açın.");
    const [workshop] = await tx.select({ id: workshopParticipants.id }).from(workshopParticipants).where(eq(workshopParticipants.draftId, id)).limit(1);
    const refusal = draftPermissions(draft, !!workshop)[action.action];
    if (refusal) throw new DraftActionError(refusal);
    if (draft.updatedAt.getTime() !== new Date(action.expectedUpdatedAt).getTime()) {
      throw new DraftActionError("Taslak başka bir işlemle değişti. Sayfayı yenileyip tekrar deneyin.");
    }
    const snapshot = (value: typeof draft): Record<string, unknown> => ({
      status: value.status, amountKurus: value.amountKurus, selectedAddons: value.selectedAddons,
      productionBaseKurus: value.productionBaseKurus, paintingPriceKurus: value.paintingPriceKurus,
      needsPainting: value.needsPainting, productTitleSnapshot: value.productTitleSnapshot,
      deadline: value.bankTransferDeadline?.toISOString() ?? null,
      preliminaryInfoAcceptedAt: value.preliminaryInfoAcceptedAt?.toISOString() ?? null,
      preliminaryInfoVersion: value.preliminaryInfoVersion, distanceContractVersion: value.distanceContractVersion,
    });
    const audit = async (after: typeof draft) => tx.insert(adminDraftActions).values({
      draftId: id, action: action.action, adminEmail, reason: action.reason,
      before: snapshot(draft), after: snapshot(after),
    });
    const current = and(eq(orderDrafts.id, id), eq(orderDrafts.status, "pending"), isNull(orderDrafts.promotedOrderId));
    if (action.action === "resend") {
      const payUrl = `${(process.env.NEXT_PUBLIC_APP_URL || "https://figurunica.com").replace(/\/$/, "")}/pay/${encodeURIComponent(draft.reference)}`;
      // Queue acknowledgement is the only success promised. If enqueue fails,
      // this request fails; no "sent" flag survives for the next retry.
      await audit(draft);
      try {
        await enqueue({ type: "admin_custom", to: draft.email, orderNumber: draft.reference,
          customerName: draft.customerName, locale: draft.locale === "en" ? "en" : "tr", adminEmail,
          customSubject: `${draft.reference} — ödeme bağlantınız`,
          customBody: `Siparişinizin güncel tutarını ve ödeme bilgilerini aşağıdaki bağlantıdan inceleyebilirsiniz. Ödeme yaptıysanız tekrar ödeme yapmayın; bizimle iletişime geçin.\n\n${payUrl}`,
        });
      } catch (error) {
        console.error("[admin-draft] payment link enqueue failed", id, error);
        throw new DraftActionError("Ödeme bağlantısı e-posta kuyruğuna alınamadı. Tekrar deneyin.", 503);
      }
      return { message: "Ödeme bağlantısı e-posta kuyruğuna alındı; teslim henüz doğrulanmadı.", before: draft, after: draft };
    }
    let changes: Partial<typeof orderDrafts.$inferInsert>;
    if (action.action === "edit") {
      const [item] = await tx.select({ id: orderItems.id }).from(orderItems).where(eq(orderItems.draftId, id)).limit(1);
      if (item) throw new DraftActionError("Bu taslağın sepet satırları var; manuel kalem listesiyle değiştirilemez.");
      try { changes = { ...draftLinesUpdate(draft, action.lines),
        // Price/lines changed: the customer's old commercial consent is no
        // longer evidence for this agreement. Content/likeness consent stays.
        preliminaryInfoAcceptedAt: null, preliminaryInfoVersion: null, distanceContractVersion: null,
      }; }
      catch (error) { throw new DraftActionError((error as Error).message, 400); }
      // Manual creation does not grant a havale discount. Preserve that
      // convention rather than silently introducing a discount on every edit.
      if (draft.havaleDiscountKurus !== 0) throw new DraftActionError("İndirimli taslakta fiyat düzenleme desteklenmiyor; mevcut ödeme tutarı korunmuştur.");
    } else if (action.action === "extend") {
      const deadline = new Date(action.deadline);
      if (deadline.getTime() <= Math.max(Date.now(), draft.bankTransferDeadline?.getTime() ?? 0)
        || deadline.getTime() > Date.now() + 90 * 86400_000) {
        throw new DraftActionError("Yeni son tarih mevcut tarihten ileri ve önümüzdeki 90 gün içinde olmalıdır.", 400);
      }
      try { await schedule(id, draft.reference, deadline); }
      catch (error) {
        console.error("[admin-draft] deadline enqueue failed", id, error);
        throw new DraftActionError("Yeni süre dolumu planlanamadı; son tarih değiştirilmedi. Tekrar deneyin.", 503);
      }
      changes = { bankTransferDeadline: deadline };
    } else {
      // Reserved gift-card funds and workshop seats are refused by the policy:
      // never leave them stranded by introducing a second release algorithm.
      changes = { status: "cancelled", paytrFailureReason: `Yönetici iptali (${adminEmail}): ${action.reason}` };
    }
    const [updated] = await tx.update(orderDrafts).set({ ...changes, updatedAt: new Date() }).where(current).returning();
    if (!updated) throw new DraftActionError("Taslak artık değiştirilebilir durumda değil.");
    await audit(updated);
    return { message: action.action === "cancel" ? "Taslak iptal edildi. Bu bağlantıyla ödeme onaylanamaz." : "Taslak güncellendi. Ödeme bağlantısı güncel bilgileri gösterir.", before: draft, after: updated };
  });
  return { success: true, message: result.message, updatedAt: result.after.updatedAt.toISOString() };
}
