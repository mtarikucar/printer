import {
  pgTable,
  text,
  timestamp,
  integer,
  doublePrecision,
  jsonb,
  boolean,
  uuid,
  pgEnum,
  uniqueIndex,
  index,
} from "drizzle-orm/pg-core";
import { relations, sql } from "drizzle-orm";

export const giftCardThemeEnum = pgEnum("gift_card_theme", [
  "ramazan",
  "dogum_gunu",
  "yeni_yil",
  "sevgililer_gunu",
  "genel",
]);

export const giftCardStatusEnum = pgEnum("gift_card_status", [
  "pending_payment",
  "active",
  "partially_used",
  "fully_used",
  "expired",
]);

export interface TurkishAddress {
  adres: string;
  mahalle?: string;
  ilce: string;
  il: string;
  postaKodu: string;
  telefon: string;
}

// orders table now contains only paid, real orders. Pre-payment state lives in order_drafts.
export const orderStatusEnum = pgEnum("order_status", [
  "paid",
  "generating",
  "processing_mesh",
  "review",
  "approved",
  "printing",
  "quality_check",
  "shipped",
  "delivered",
  "failed_generation",
  "failed_mesh",
  "rejected",
]);

export const paymentMethodEnum = pgEnum("payment_method", [
  "card",
  "bank_transfer",
  "gift_card_full",
]);

// Marketplace vs custom fulfillment. `custom` = the legacy photo→AI→print flow.
// `marketplace` = a customer bought a ready-made product a seller (manufacturer
// or admin/platform) listed; no AI generation, the owning seller is auto-assigned.
// Default `custom` keeps every legacy row + the existing checkout path unchanged.
export const orderTypeEnum = pgEnum("order_type", ["custom", "marketplace", "upload"]);

// Faz 3: lifecycle of a customer-uploaded STL/OBJ model.
export const uploadModelStatusEnum = pgEnum("upload_model_status", [
  "uploaded", // file saved, not yet processed
  "processing", // model-prep worker running (geometry validate + GLB preview)
  "ready", // priced, previewable, orderable
  "review", // needs a manual quote (guardrail tripped)
  "failed", // unprocessable file
]);

// Faz 3: admin quote lifecycle for an upload that couldn't be auto-priced.
export const uploadQuoteStatusEnum = pgEnum("upload_quote_status", [
  "none",
  "quoted",
  "accepted",
  "expired",
  "rejected",
]);

// orders only contain paid orders, so paymentStatus is succeeded or refunded.
export const paymentStatusEnum = pgEnum("payment_status", [
  "succeeded",
  "refunded",
]);

// Lifecycle of an order draft (pre-payment).
export const orderDraftStatusEnum = pgEnum("order_draft_status", [
  "pending",
  "awaiting_review",
  "confirmed",
  "expired",
  "failed",
  "cancelled",
]);

// Confidence band for OCR scan of an uploaded havale receipt.
export const ocrConfidenceEnum = pgEnum("ocr_confidence", [
  "high",
  "medium",
  "low",
]);

export const generationProviderEnum = pgEnum("generation_provider", [
  "tripo3d",
  "meshy",
]);

export const generationStatusEnum = pgEnum("generation_status", [
  "pending",
  "running",
  "succeeded",
  "failed",
]);

export const adminActionTypeEnum = pgEnum("admin_action_type", [
  "approve",
  "reject",
  "regenerate",
  "print",
  "ship",
  "confirm",
  "deliver",
  "message_email",
  "edit",
  "force_review",
  "assign_manufacturer",
  "mark_havale_paid",
  "mark_payment_expired",
  "gallery_approve",
  "gallery_reject",
  "gallery_reward",
  "gallery_feature",
  "gallery_unfeature",
  "qc_approve",
  "qc_reject",
]);

/**
 * Lifecycle of a customer-requested gallery publication.
 *   `none`      → never requested (default for legacy rows + non-published orders)
 *   `pending`   → customer opted in via PublishToggle, awaiting admin moderation
 *   `approved`  → admin approved; `isPublic` flipped true and the figurine appears
 *                 in the gallery
 *   `rejected`  → admin rejected; `galleryReviewReason` stores the moderator note
 */
export const galleryReviewStatusEnum = pgEnum("gallery_review_status", [
  "none",
  "pending",
  "approved",
  "rejected",
]);

export const figurineSizeEnum = pgEnum("figurine_size", [
  "kucuk",
  "orta",
  "buyuk",
]);

export const figurineStyleEnum = pgEnum("figurine_style", [
  "realistic",
  "storybook",
  "anime",
  "chibi",
  "object",
]);

// Print material — resin (premium) vs filament (FDM). Drives per-material
// pricing and manufacturer routing. Default resin (historical behaviour).
export const figurineMaterialEnum = pgEnum("figurine_material", ["resin", "filament"]);

// Finish/package tier (Faz 1.1). paintable_kit = default DIY kit (mini paint
// kit included); hand_painted = professional hand-finish upgrade; luxe_display
// = premium base + box + full hand paint; collector_raw = unpainted raw print
// (enum-only for now, not yet surfaced in the create UI). Surcharges are
// additive — see FINISH_SURCHARGES_KURUS in src/lib/config/prices.ts.
export const figurineFinishEnum = pgEnum("figurine_finish", [
  "paintable_kit",
  "hand_painted",
  "collector_raw",
  "luxe_display",
  // Object / design / upload prints (geometry, not character sculpts):
  "raw",
  "smoothed",
  "painted",
]);

export const previewStatusEnum = pgEnum("preview_status", [
  "generating",
  "ready",
  "failed",
  "approved",
  "revision_requested",
  "expired",
]);

export const manufacturerStatusEnum = pgEnum("manufacturer_status", [
  "pending_approval",
  "conditionally_approved",
  "active",
  "suspended",
  "rejected",
]);

export const manufacturerOrderStatusEnum = pgEnum("manufacturer_order_status", [
  "unassigned",
  "assigned",
  "accepted",
  "printing",
  "printed",
  "qc_pending",
  "qc_rejected",
  "qc_approved",
  "shipped",
]);

// Faz 3: shipping carrier (drives the customer tracking deep-link).
export const carrierEnum = pgEnum("carrier", [
  "yurtici",
  "aras",
  "mng",
  "ptt",
  "surat",
  "other",
]);

// Faz 3: IBAN change review gate. 'pending' means a new IBAN is parked in
// manufacturers.pendingIban awaiting admin approval.
export const ibanReviewStatusEnum = pgEnum("iban_review_status", ["none", "pending"]);

// ─── Marketplace: seller-listed products ────────────────────────────────────
// Product lifecycle. Sellers create as `draft`, submit to `pending_review`,
// an admin approves to `active` (buyable + visible) or `rejected`. `archived`
// hides a previously-active listing. Admin/platform products skip straight to
// `active` on create (no self-review).
export const productStatusEnum = pgEnum("product_status", [
  "draft",
  "pending_review",
  "active",
  "rejected",
  "archived",
]);

// Who owns/fulfills the product: a `seller` (manufacturer, the common case) or
// the platform itself (`admin`). Admin products carry a NULL manufacturerId and
// are fulfilled through the existing admin order pipeline.
export const productOwnerTypeEnum = pgEnum("product_owner_type", ["seller", "admin"]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  googleId: text("google_id"),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  defaultAddress: jsonb("default_address").$type<TurkishAddress>(),
  // Password-reset flow (N3 in roadmap). Tokens are sha256 hashes of the
  // single-use raw token emailed to the user; the raw value never lives in
  // the DB so a leak of this table doesn't grant account access.
  passwordResetTokenHash: text("password_reset_token_hash"),
  passwordResetExpiresAt: timestamp("password_reset_expires_at"),
  // Guest-checkout flag (Q6). True while the customer placed an order
  // without explicitly registering — they have a row in `users` but never
  // set a password. Flipped false once they claim the account via the
  // post-purchase email (which reuses the password-reset token flow).
  isGuest: boolean("is_guest").notNull().default(false),
  // İYS / commercial-electronic-message consent (ETK, law 6563). Opt-in only;
  // marketingConsentAt records WHEN consent was given (required for İYS records).
  marketingConsent: boolean("marketing_consent").notNull().default(false),
  marketingConsentAt: timestamp("marketing_consent_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Saved shipping addresses for logged-in customers (Q5 in roadmap).
// `defaultAddress` on users is for legacy/single-address compatibility; this
// table lets a customer keep multiple labeled addresses ("Ev", "İş") and
// prefill the /create flow without re-typing.
export const userAddresses = pgTable(
  "user_addresses",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    fullName: text("full_name").notNull(),
    phone: text("phone").notNull(),
    adres: text("adres").notNull(),
    mahalle: text("mahalle"),
    ilce: text("ilce").notNull(),
    il: text("il").notNull(),
    postaKodu: text("posta_kodu").notNull(),
    isDefault: boolean("is_default").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    // Q5 review I3: partial unique index enforces "at most one default
    // per user" at the DB level. Catches the race where two
    // concurrent createAddress calls both see existing.length === 0
    // and both try to insert with isDefault=true; the loser's INSERT
    // fails on this index and the service catch-block can retry as
    // non-default. Same protection covers setDefaultAddress.
    oneDefaultPerUser: uniqueIndex("user_addresses_one_default_idx")
      .on(t.userId)
      .where(sql`${t.isDefault} = true`),
  })
);

export const previews = pgTable("previews", {
  id: uuid("id").primaryKey().defaultRandom(),
  userId: uuid("user_id").references(() => users.id),
  photoKey: text("photo_key").notNull(),
  photoUrl: text("photo_url").notNull(),
  figurineSize: figurineSizeEnum("figurine_size").notNull(),
  style: figurineStyleEnum("style").notNull().default("realistic"),
  modifiers: jsonb("modifiers").$type<string[]>(),
  status: previewStatusEnum("status").notNull().default("generating"),
  glbUrl: text("glb_url"),
  glbKey: text("glb_key"),
  objUrl: text("obj_url"),
  objKey: text("obj_key"),
  stlUrl: text("stl_url"),
  stlKey: text("stl_key"),
  meshyTaskId: text("meshy_task_id"),
  revisionNote: text("revision_note"),
  errorMessage: text("error_message"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Pre-payment intent. Only promoted to orders once payment is verified
// (PayTR webhook success, dekont OCR auto-confirm, or admin manual mark-paid).
export const orderDrafts = pgTable("order_drafts", {
  id: uuid("id").primaryKey().defaultRandom(),
  reference: text("reference").notNull().unique(), // shown to customer; also used as PayTR merchant_oid input
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  previewId: uuid("preview_id").references(() => previews.id),
  // Faz 3: customer-uploaded STL/OBJ model (null for custom/marketplace).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uploadedModelId: uuid("uploaded_model_id").references((): any => uploadedModels.id),
  email: text("email").notNull(),
  customerName: text("customer_name").notNull(),
  phone: text("phone"),
  // Custom-order fields. Nullable since marketplace drafts carry no uploaded
  // photo / size choice — the product defines what's printed.
  figurineSize: figurineSizeEnum("figurine_size"),
  style: figurineStyleEnum("style").notNull().default("realistic"),
  modifiers: jsonb("modifiers").$type<string[]>(),
  material: figurineMaterialEnum("material").notNull().default("resin"),
  finish: figurineFinishEnum("finish").notNull().default("paintable_kit"),
  shippingAddress: jsonb("shipping_address").notNull().$type<TurkishAddress>(),
  photoKey: text("photo_key"),
  // Marketplace fields (null for custom drafts). See orderTypeEnum.
  orderType: orderTypeEnum("order_type").notNull().default("custom"),
  // Faz 4: groups sibling sub-orders from one cart checkout (one order/seller).
  parentReference: text("parent_reference"),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  productId: uuid("product_id").references((): any => products.id),
  sellerManufacturerId: uuid("seller_manufacturer_id").references(
    () => manufacturers.id
  ),
  // Immutable copy of the product title at purchase time, so invoices/history
  // survive a later product edit or archive.
  productTitleSnapshot: text("product_title_snapshot"),
  quantity: integer("quantity").notNull().default(1),
  locale: text("locale").notNull().default("tr"),
  amountKurus: integer("amount_kurus").notNull(),
  // The forward ref is safe — drizzle resolves the arrow lazily, and at runtime
  // the giftCards table object already exists by the time DDL is emitted.
  // `: any` on the arrow's return is necessary because TypeScript evaluates
  // the type eagerly and giftCards isn't typed yet at this point in the file;
  // drizzle's runtime resolution is unaffected.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  giftCardId: uuid("gift_card_id").references((): any => giftCards.id),
  giftCardAmountKurus: integer("gift_card_amount_kurus").notNull().default(0),
  havaleDiscountKurus: integer("havale_discount_kurus").notNull().default(0),
  // Checkout add-ons (Q10): keys like "extra_paint", "gift_wrap",
  // "rush_shipping". Pricing lives in src/lib/config/prices.ts; the sum is
  // stored alongside in `upsellAmountKurus` so admin tooling doesn't have to
  // re-derive it from the keys.
  upsells: jsonb("upsells").$type<string[]>(),
  upsellAmountKurus: integer("upsell_amount_kurus").notNull().default(0),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  status: orderDraftStatusEnum("status").notNull().default("pending"),
  // PayTR
  paytrMerchantOid: text("paytr_merchant_oid").unique(),
  paytrTestMode: boolean("paytr_test_mode"),
  paytrPaymentType: text("paytr_payment_type"),
  paytrFailureReason: text("paytr_failure_reason"),
  // Havale
  bankTransferDeadline: timestamp("bank_transfer_deadline"),
  bankTransferReceiptKey: text("bank_transfer_receipt_key"),
  bankTransferReceiptUploadedAt: timestamp("bank_transfer_receipt_uploaded_at"),
  bankTransferReminderSentAt: timestamp("bank_transfer_reminder_sent_at"),
  // OCR
  receiptOcrText: text("receipt_ocr_text"),
  receiptOcrParsed: jsonb("receipt_ocr_parsed").$type<{
    amountKurus?: number;
    iban?: string;
    sender?: string;
    referenceFound?: boolean;
    /** True when matched via fuzzy (Levenshtein) rather than exact substring. */
    referenceFuzzyMatched?: boolean;
    date?: string;
    /** Set by ocrDekont when called with expectedIban: true=match,
     *  false=mismatch (fraud signal), null/undefined=no expected supplied. */
    ibanMatchesExpected?: boolean | null;
    /** Bank identified by header keywords; "generic" if no bank parser matched. */
    bank?:
      | "garanti"
      | "ziraat"
      | "is_bankasi"
      | "yapi_kredi"
      | "akbank"
      | "generic";
  }>(),
  receiptOcrConfidence: ocrConfidenceEnum("receipt_ocr_confidence"),
  receiptOcrFailureReason: text("receipt_ocr_failure_reason"),
  // Promotion
  promotedOrderId: uuid("promoted_order_id"),
  promotedAt: timestamp("promoted_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNumber: text("order_number").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  previewId: uuid("preview_id").references(() => previews.id),
  // Faz 3: customer-uploaded STL/OBJ model (null for custom/marketplace).
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  uploadedModelId: uuid("uploaded_model_id").references((): any => uploadedModels.id),
  draftId: uuid("draft_id").references(() => orderDrafts.id),
  email: text("email").notNull(),
  customerName: text("customer_name").notNull(),
  phone: text("phone"),
  // Custom-order field. Nullable since marketplace orders carry no size choice.
  figurineSize: figurineSizeEnum("figurine_size"),
  style: figurineStyleEnum("style").notNull().default("realistic"),
  modifiers: jsonb("modifiers").$type<string[]>(),
  material: figurineMaterialEnum("material").notNull().default("resin"),
  finish: figurineFinishEnum("finish").notNull().default("paintable_kit"),
  shippingAddress: jsonb("shipping_address").notNull().$type<TurkishAddress>(),
  // Marketplace fields (null for custom orders). Copied from the draft on
  // promotion. sellerManufacturerId snapshots the product owner at purchase.
  orderType: orderTypeEnum("order_type").notNull().default("custom"),
  // Faz 4: groups sibling sub-orders from one cart checkout (one order/seller).
  parentReference: text("parent_reference"),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  productId: uuid("product_id").references((): any => products.id),
  sellerManufacturerId: uuid("seller_manufacturer_id").references(
    () => manufacturers.id
  ),
  productTitleSnapshot: text("product_title_snapshot"),
  quantity: integer("quantity").notNull().default(1),
  status: orderStatusEnum("status").notNull().default("paid"),
  locale: text("locale").notNull().default("tr"),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("succeeded"),
  amountKurus: integer("amount_kurus").notNull(),
  havaleDiscountKurus: integer("havale_discount_kurus").notNull().default(0),
  giftCardAmountKurus: integer("gift_card_amount_kurus").notNull().default(0),
  // Copied verbatim from the draft when an order is promoted. See orderDrafts
  // for the schema rationale; the manufacturer queue UI reads these to
  // surface "gift wrap" / "rush" handling flags on the print card.
  upsells: jsonb("upsells").$type<string[]>(),
  upsellAmountKurus: integer("upsell_amount_kurus").notNull().default(0),
  paidAt: timestamp("paid_at").notNull().defaultNow(),
  shippedAt: timestamp("shipped_at"),
  trackingNumber: text("tracking_number"),
  carrier: carrierEnum("carrier"),
  deliveredAt: timestamp("delivered_at"),
  adminNotes: text("admin_notes"),
  failureReason: text("failure_reason"),
  retryCount: integer("retry_count").notNull().default(0),
  isPublic: boolean("is_public").notNull().default(false),
  publicDisplayName: text("public_display_name"),
  publishedAt: timestamp("published_at"),
  // Q3: SEO-friendly shareable URL fragment, e.g. "ayse-yilmaz-fig-abc123".
  // Set when admin approves the gallery item; null otherwise. Unique so a
  // single slug always resolves to one order — collisions get a suffix.
  gallerySlug: text("gallery_slug").unique(),
  galleryCategory: text("gallery_category"),
  galleryTags: jsonb("gallery_tags").$type<string[]>(),
  // Customer-requested gallery publication moderation (Q4 in roadmap).
  // `isPublic` only flips true when reviewStatus reaches `approved`.
  galleryReviewStatus: galleryReviewStatusEnum("gallery_review_status")
    .notNull()
    .default("none"),
  galleryReviewReason: text("gallery_review_reason"),
  // Optional reward: when admin chooses to grant a gift card during gallery
  // approval, this FK links to the issued card so customer support can audit.
  galleryRewardGiftCardId: uuid("gallery_reward_gift_card_id").references(
    (): any => giftCards.id // eslint-disable-line @typescript-eslint/no-explicit-any
  ),
  // Admin-curated highlight. Featured items surface in the "Öne Çıkan
  // Figürinler" rail at the top of the public gallery. Only meaningful when
  // isPublic=true; galleryFeaturedAt drives the rail ordering (newest first).
  galleryFeatured: boolean("gallery_featured").notNull().default(false),
  galleryFeaturedAt: timestamp("gallery_featured_at"),
  manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id),
  manufacturerStatus: manufacturerOrderStatusEnum("manufacturer_status"),
  assignedToManufacturerAt: timestamp("assigned_to_manufacturer_at"),
  manufacturerAcceptedAt: timestamp("manufacturer_accepted_at"),
  manufacturerPrintedAt: timestamp("manufacturer_printed_at"),
  // N12: list of manufacturers who declined this order. Used by the
  // reassignment service to skip them on retry and to cap the reassign
  // count (3 declines → admin manual queue).
  declinedManufacturerIds: jsonb("declined_manufacturer_ids").$type<string[]>(),
  // QC reprint loop: qcRound bumps on each admin rejection (so the manufacturer
  // page shows only the current round); qcRejectionCount is a lifetime counter
  // for escalation/metrics.
  qcRound: integer("qc_round").notNull().default(1),
  qcRejectionCount: integer("qc_rejection_count").notNull().default(0),
  // Customer special instructions captured at checkout (e.g. "gift — no invoice
  // in box"). Shown read-only to the manufacturer; editable by the customer
  // until the order ships.
  customerNote: text("customer_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const orderPhotos = pgTable("order_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  originalUrl: text("original_url").notNull(),
  thumbnailUrl: text("thumbnail_url"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── QC (quality control): finished-product photos + admin reviews ──────────
export const qcPhotoReviewStatusEnum = pgEnum("qc_photo_review_status", [
  "pending",
  "approved",
  "rejected",
]);

// Manufacturer-uploaded photos of the FINISHED printed product, reviewed by an
// admin before shipping is unlocked. Deliberately separate from order_photos
// (the customer's INPUT photos) so the two never leak into each other's UI.
// storageKey is a relative key (e.g. "qc-photos/<id>.jpg") re-signed on read.
export const qcPhotos = pgTable("qc_photos", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  manufacturerId: uuid("manufacturer_id")
    .notNull()
    .references(() => manufacturers.id),
  round: integer("round").notNull().default(1),
  storageKey: text("storage_key").notNull(),
  thumbnailKey: text("thumbnail_key"),
  reviewStatus: qcPhotoReviewStatusEnum("review_status")
    .notNull()
    .default("pending"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// One row per admin QC decision (per round): audit trail + the reject reason
// surfaced back to the manufacturer.
export const qcReviews = pgTable("qc_reviews", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  round: integer("round").notNull(),
  decision: text("decision").notNull(), // 'approved' | 'rejected'
  reason: text("reason"),
  adminEmail: text("admin_email").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Per-order, two-channel messaging ───────────────────────────────────────
export const messageChannelEnum = pgEnum("message_channel", [
  "customer_admin",
  "manufacturer_admin",
]);
export const messageSenderTypeEnum = pgEnum("message_sender_type", [
  "customer",
  "admin",
  "manufacturer",
]);

// Bidirectional chat scoped to (orderId, channel). The two channels never mix:
// customer↔admin and manufacturer↔admin. channel + senderType are always
// derived server-side from the authenticated role (see order-messages.ts),
// never from the request body, so a customer can't touch the manufacturer
// channel and vice-versa. Two read-timestamps suffice (each channel has exactly
// two participants: admin + one counterparty).
export const messages = pgTable(
  "messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id),
    channel: messageChannelEnum("channel").notNull(),
    senderType: messageSenderTypeEnum("sender_type").notNull(),
    senderId: uuid("sender_id"), // user/manufacturer UUID; null for admin
    senderEmail: text("sender_email"), // admin identity (NextAuth email)
    body: text("body").notNull(),
    attachmentKey: text("attachment_key"),
    attachmentThumbnailKey: text("attachment_thumbnail_key"),
    readByAdminAt: timestamp("read_by_admin_at"),
    readByCounterpartyAt: timestamp("read_by_counterparty_at"),
    flagged: boolean("flagged").notNull().default(false),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byOrderChannel: index("messages_order_channel_idx").on(
      t.orderId,
      t.channel,
      t.createdAt
    ),
  })
);

// ─── Faz 2: manufacturer earnings + payouts + customer invoices ─────────────
export const earningStatusEnum = pgEnum("earning_status", [
  "pending",
  "paid",
  "reversed",
]);
export const payoutStatusEnum = pgEnum("payout_status", ["pending", "paid"]);
export const invoiceStatusEnum = pgEnum("invoice_status", ["draft", "issued"]);

// One earning row per order, accrued when the manufacturer ships. net = gross −
// platform commission. Linked into a payout batch when paid; reversed on
// refund/dispute (clawback).
export const manufacturerEarnings = pgTable("manufacturer_earnings", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id)
    .unique(),
  manufacturerId: uuid("manufacturer_id")
    .notNull()
    .references(() => manufacturers.id),
  grossKurus: integer("gross_kurus").notNull(),
  commissionKurus: integer("commission_kurus").notNull(),
  netKurus: integer("net_kurus").notNull(),
  commissionRateBps: integer("commission_rate_bps").notNull(),
  status: earningStatusEnum("status").notNull().default("pending"),
  payoutId: uuid("payout_id").references((): any => payouts.id), // eslint-disable-line @typescript-eslint/no-explicit-any
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// A payout batch aggregates a manufacturer's pending earnings into one transfer.
export const payouts = pgTable("payouts", {
  id: uuid("id").primaryKey().defaultRandom(),
  manufacturerId: uuid("manufacturer_id")
    .notNull()
    .references(() => manufacturers.id),
  totalKurus: integer("total_kurus").notNull(),
  earningCount: integer("earning_count").notNull(),
  status: payoutStatusEnum("status").notNull().default("pending"),
  reference: text("reference"),
  adminEmail: text("admin_email").notNull(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  paidAt: timestamp("paid_at"),
});

// Customer invoice (KDV-inclusive). invoiceNumber is 1:1 with the order.
export const invoices = pgTable("invoices", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id)
    .unique(),
  invoiceNumber: text("invoice_number").notNull().unique(),
  subtotalKurus: integer("subtotal_kurus").notNull(),
  kdvKurus: integer("kdv_kurus").notNull(),
  totalKurus: integer("total_kurus").notNull(),
  kdvRateBps: integer("kdv_rate_bps").notNull(),
  status: invoiceStatusEnum("status").notNull().default("issued"),
  providerRef: text("provider_ref"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Faz 3: manufacturer KYC documents + customer disputes ──────────────────
export const docTypeEnum = pgEnum("manufacturer_doc_type", [
  "vergi_levhasi",
  "ticaret_sicil",
  "imza_sirkuleri",
  "kimlik",
  "printer_photo",
  "other",
]);
export const docReviewStatusEnum = pgEnum("doc_review_status", [
  "pending",
  "approved",
  "rejected",
]);
export const disputeStatusEnum = pgEnum("dispute_status", [
  "open",
  "resolved",
  "rejected",
]);

// KYC documents a manufacturer uploads during/after onboarding; an admin
// reviews each one. storageKey is a relative key under kyc-docs/.
export const manufacturerDocuments = pgTable("manufacturer_documents", {
  id: uuid("id").primaryKey().defaultRandom(),
  manufacturerId: uuid("manufacturer_id")
    .notNull()
    .references(() => manufacturers.id),
  type: docTypeEnum("type").notNull(),
  storageKey: text("storage_key").notNull(),
  status: docReviewStatusEnum("status").notNull().default("pending"),
  reviewNote: text("review_note"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

// Customer-opened dispute on an order; admin resolves (optionally clawing back
// the manufacturer's earning + refunding).
export const disputes = pgTable("disputes", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  category: text("category").notNull(), // not_as_described | damaged | not_received | other
  description: text("description").notNull(),
  status: disputeStatusEnum("status").notNull().default("open"),
  resolution: text("resolution"),
  adminEmail: text("admin_email"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  resolvedAt: timestamp("resolved_at"),
});

// ─── Faz 4: customer in-app notification center ─────────────────────────────
export const customerNotifications = pgTable(
  "customer_notifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    orderId: uuid("order_id").references(() => orders.id),
    type: text("type").notNull(), // order_shipped | order_delivered | dispute_update | ...
    title: text("title").notNull(),
    body: text("body").notNull(),
    readAt: timestamp("read_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("customer_notifications_user_idx").on(t.userId, t.createdAt),
  })
);

export const generationAttempts = pgTable("generation_attempts", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  provider: generationProviderEnum("provider").notNull(),
  providerTaskId: text("provider_task_id"),
  status: generationStatusEnum("status").notNull().default("pending"),
  inputImageUrl: text("input_image_url").notNull(),
  outputGlbUrl: text("output_glb_url"),
  outputStlUrl: text("output_stl_url"),
  outputObjUrl: text("output_obj_url"),
  errorMessage: text("error_message"),
  costCents: integer("cost_cents"),
  durationMs: integer("duration_ms"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const meshReports = pgTable("mesh_reports", {
  id: uuid("id").primaryKey().defaultRandom(),
  generationId: uuid("generation_id")
    .notNull()
    .references(() => generationAttempts.id),
  isWatertight: boolean("is_watertight").notNull(),
  isVolume: boolean("is_volume").notNull(),
  vertexCount: integer("vertex_count").notNull(),
  faceCount: integer("face_count").notNull(),
  componentCount: integer("component_count").notNull(),
  boundingBox: jsonb("bounding_box").$type<{
    min: [number, number, number];
    max: [number, number, number];
    size: [number, number, number];
  }>(),
  baseAdded: boolean("base_added").notNull().default(false),
  repairsApplied: jsonb("repairs_applied").$type<string[]>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

export const adminActions = pgTable("admin_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  action: adminActionTypeEnum("action").notNull(),
  adminEmail: text("admin_email").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Admin → customer email log (was previously email|whatsapp; whatsapp removed).
export const adminMessages = pgTable("admin_messages", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id")
    .notNull()
    .references(() => orders.id),
  subject: text("subject"),
  body: text("body").notNull(),
  templateKey: text("template_key"),
  adminEmail: text("admin_email").notNull(),
  sentAt: timestamp("sent_at").notNull().defaultNow(),
});

// Manufacturers
export const manufacturers = pgTable("manufacturers", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  companyName: text("company_name").notNull(),
  contactPerson: text("contact_person").notNull(),
  phone: text("phone").notNull(),
  whatsappPhone: text("whatsapp_phone"),
  address: jsonb("address").$type<TurkishAddress>(),
  capabilities: jsonb("capabilities").$type<string[]>(),
  taxId: text("tax_id"),
  taxIdType: text("tax_id_type"),
  requiresManualTaxReview: boolean("requires_manual_tax_review").notNull().default(false),
  // Bank / payout
  iban: text("iban"),
  bankAccountHolder: text("bank_account_holder"),
  bankName: text("bank_name"),
  // Capacity
  maxConcurrentOrders: integer("max_concurrent_orders").notNull().default(5),
  acceptingOrders: boolean("accepting_orders").notNull().default(true),
  // Onboarding
  onboardingAcceptedAt: timestamp("onboarding_accepted_at"),
  status: manufacturerStatusEnum("status").notNull().default("pending_approval"),
  // Verification flow (issue #2): rejection note shown to the applicant, and the
  // timestamp the conditionally-approved manufacturer uploaded their 3D-printer
  // photo (gates the admin "Approve" action + the manufacturer upload screen).
  rejectionReason: text("rejection_reason"),
  printerPhotoUploadedAt: timestamp("printer_photo_uploaded_at"),
  notes: text("notes"),
  // Faz 2/3: accumulating reliability strikes (late ship, cancel-after-accept,
  // QC fail). Faz 3 policy auto-suspends past a threshold.
  strikeCount: integer("strike_count").notNull().default(0),
  // Faz 3: IBAN changes require admin re-approval. New value parks here until
  // approved; the live `iban` is only updated on approval.
  pendingIban: text("pending_iban"),
  ibanReviewStatus: ibanReviewStatusEnum("iban_review_status").notNull().default("none"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const manufacturerActions = pgTable("manufacturer_actions", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderId: uuid("order_id").notNull().references(() => orders.id),
  manufacturerId: uuid("manufacturer_id").notNull().references(() => manufacturers.id),
  action: text("action").notNull(),
  notes: text("notes"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// Q7: shadow + canary log for manufacturer scoring v2 rollout. Every
// assignment evaluation writes one row capturing both v1 + v2 winners
// (or v2 alone once cutover happens). Used by /admin/scoring-evaluations
// to eyeball disagreement before flipping the percent dial up.
//
// Unique (order_id, weights_version) prevents N12 decline-retry storms
// from filling the table with duplicate evaluations for the same order
// against the same scoring profile.
export const manufacturerAssignmentEvaluations = pgTable(
  "manufacturer_assignment_evaluations",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id")
      .notNull()
      .references(() => orders.id, { onDelete: "cascade" }),
    v1WinnerId: uuid("v1_winner_id").references(() => manufacturers.id),
    v2WinnerId: uuid("v2_winner_id").references(() => manufacturers.id),
    v1Scores: jsonb("v1_scores"),
    v2Scores: jsonb("v2_scores"),
    weightsVersion: text("weights_version").notNull(),
    /** "v1" while shadow, flips per-row as canary expands and at cutover. */
    authoritative: text("authoritative").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    orderVersionUnique: uniqueIndex("mfg_eval_order_version_idx").on(
      t.orderId,
      t.weightsVersion
    ),
  })
);

// Admin → manufacturer notifications. Email is the delivery channel; this row is the durable record + inbox source.
export const manufacturerNotifications = pgTable("manufacturer_notifications", {
  id: uuid("id").primaryKey().defaultRandom(),
  manufacturerId: uuid("manufacturer_id").notNull().references(() => manufacturers.id),
  orderId: uuid("order_id").references(() => orders.id),
  type: text("type").notNull(), // 'order_assigned' | 'order_cancelled' | 'admin_message' | 'system_announcement'
  subject: text("subject").notNull(),
  body: text("body").notNull(),
  emailSentAt: timestamp("email_sent_at"),
  emailFailedReason: text("email_failed_reason"),
  readAt: timestamp("read_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
});

// ─── Marketplace products ───────────────────────────────────────────────────
// A ready-made product a seller lists for sale. Made-to-order: no stock/quantity
// tracking — when bought, the owning manufacturer is auto-assigned to print &
// ship. ownerType="admin" products carry a NULL manufacturerId (platform-owned).
export const products = pgTable(
  "products",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    // SEO URL fragment for /shop/[slug]; minted on approval/create with a
    // collision suffix (mirrors orders.gallerySlug). Unique so a slug always
    // resolves to one product.
    slug: text("slug").unique(),
    ownerType: productOwnerTypeEnum("owner_type").notNull().default("seller"),
    // The fulfilling seller. NULL when ownerType="admin" (platform product).
    manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id),
    title: text("title").notNull(),
    description: text("description").notNull(),
    // Seller-set, KDV-inclusive (same convention as figurine prices).
    priceKurus: integer("price_kurus").notNull(),
    material: figurineMaterialEnum("material"),
    category: text("category"),
    leadTimeDays: integer("lead_time_days").default(7),
    // Denormalized cover image key for list cards (avoids a join on /shop).
    primaryImageKey: text("primary_image_key"),
    status: productStatusEnum("status").notNull().default("draft"),
    rejectionReason: text("rejection_reason"),
    reviewedByEmail: text("reviewed_by_email"),
    reviewedAt: timestamp("reviewed_at"),
    submittedAt: timestamp("submitted_at"),
    createdByAdminEmail: text("created_by_admin_email"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    byStatusCreated: index("products_status_created_idx").on(
      t.status,
      t.createdAt
    ),
    byManufacturerStatus: index("products_manufacturer_status_idx").on(
      t.manufacturerId,
      t.status
    ),
  })
);

// Product gallery images. storageKey is a relative key under products/,
// re-signed on read via getPublicUrl (mirrors qcPhotos).
export const productImages = pgTable(
  "product_images",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id, { onDelete: "cascade" }),
    storageKey: text("storage_key").notNull(),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byProduct: index("product_images_product_idx").on(t.productId, t.sortOrder),
  })
);

// ─── Faz 3: customer-uploaded models (STL/OBJ → print) ──────────────────────
// One row per uploaded model (modeled on `previews`). The upload + server-side
// geometry (volume / bbox / wall-thickness, via process_upload_model.py) drive
// auto pricing; a guardrail failure flips status→review for a manual quote.
export const uploadedModels = pgTable(
  "uploaded_models",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id").references(() => users.id),
    sourceKey: text("source_key").notNull(),
    sourceFormat: text("source_format").notNull(), // 'stl' | 'obj'
    fileName: text("file_name").notNull(),
    fileSizeBytes: integer("file_size_bytes").notNull(),
    targetHeightMm: integer("target_height_mm").notNull().default(80),
    material: figurineMaterialEnum("material").notNull().default("resin"),
    status: uploadModelStatusEnum("status").notNull().default("uploaded"),
    // Geometry — filled by the model-prep worker.
    isVolume: boolean("is_volume"),
    volumeMm3: doublePrecision("volume_mm3"),
    boundingBoxMm: jsonb("bounding_box_mm").$type<{ x: number; y: number; z: number }>(),
    minWallThicknessMm: doublePrecision("min_wall_thickness_mm"),
    printRisk: jsonb("print_risk").$type<string[]>(),
    glbPreviewKey: text("glb_preview_key"),
    thumbnailKey: text("thumbnail_key"),
    // Auto price (kuruş) when geometry is clean; null + needsQuote otherwise.
    priceKurus: integer("price_kurus"),
    needsQuote: boolean("needs_quote").notNull().default(false),
    // Faz 3 quote-bridge — set by admin when geometry can't be auto-priced.
    quotedPriceKurus: integer("quoted_price_kurus"),
    quoteStatus: uploadQuoteStatusEnum("quote_status").notNull().default("none"),
    quotedByEmail: text("quoted_by_email"),
    quotedAt: timestamp("quoted_at"),
    quoteExpiresAt: timestamp("quote_expires_at"),
    // Contact email for the quote (guest uploads carry no userId).
    contactEmail: text("contact_email"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
    updatedAt: timestamp("updated_at").notNull().defaultNow(),
  },
  (t) => ({
    byUser: index("uploaded_models_user_idx").on(t.userId, t.createdAt),
  })
);

// Faz 4: line items for a multi-product cart order. Only cart (marketplace)
// orders use these; single-item bespoke orders keep their scalar columns and
// carry no orderItems. On promotion a cart draft fans out into one order per
// seller, each re-pointing its own items from draftId → orderId.
export const orderItems = pgTable(
  "order_items",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    orderId: uuid("order_id").references(() => orders.id),
    draftId: uuid("draft_id").references(() => orderDrafts.id),
    productId: uuid("product_id").references(() => products.id),
    sellerManufacturerId: uuid("seller_manufacturer_id").references(
      () => manufacturers.id
    ),
    productTitleSnapshot: text("product_title_snapshot").notNull(),
    unitPriceKurus: integer("unit_price_kurus").notNull(),
    quantity: integer("quantity").notNull().default(1),
    lineTotalKurus: integer("line_total_kurus").notNull(),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byOrder: index("order_items_order_idx").on(t.orderId),
    byDraft: index("order_items_draft_idx").on(t.draftId),
  })
);

// Faz 5: product reviews. A customer may review a product they received — one
// review per (product, user, order). Auto-approved with admin takedown.
export const productReviewStatusEnum = pgEnum("product_review_status", [
  "approved",
  "pending",
  "rejected",
]);
export const productReviews = pgTable(
  "product_reviews",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    productId: uuid("product_id")
      .notNull()
      .references(() => products.id),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id),
    orderId: uuid("order_id").references(() => orders.id),
    rating: integer("rating").notNull(),
    title: text("title"),
    body: text("body"),
    status: productReviewStatusEnum("status").notNull().default("approved"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (t) => ({
    byProduct: index("product_reviews_product_idx").on(t.productId, t.status),
    uniqPerOrder: uniqueIndex("product_reviews_unique_idx").on(
      t.productId,
      t.userId,
      t.orderId
    ),
  })
);

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  drafts: many(orderDrafts),
  previews: many(previews),
  giftCards: many(giftCards),
  addresses: many(userAddresses),
  notifications: many(customerNotifications),
}));

export const userAddressesRelations = relations(userAddresses, ({ one }) => ({
  user: one(users, {
    fields: [userAddresses.userId],
    references: [users.id],
  }),
}));

export const previewsRelations = relations(previews, ({ one }) => ({
  user: one(users, { fields: [previews.userId], references: [users.id] }),
}));

export const orderDraftsRelations = relations(orderDrafts, ({ one }) => ({
  user: one(users, { fields: [orderDrafts.userId], references: [users.id] }),
  preview: one(previews, {
    fields: [orderDrafts.previewId],
    references: [previews.id],
  }),
  giftCard: one(giftCards, {
    fields: [orderDrafts.giftCardId],
    references: [giftCards.id],
  }),
  promotedOrder: one(orders, {
    fields: [orderDrafts.promotedOrderId],
    references: [orders.id],
  }),
  product: one(products, {
    fields: [orderDrafts.productId],
    references: [products.id],
  }),
}));

export const ordersRelations = relations(orders, ({ one, many }) => ({
  user: one(users, {
    fields: [orders.userId],
    references: [users.id],
  }),
  preview: one(previews, {
    fields: [orders.previewId],
    references: [previews.id],
  }),
  draft: one(orderDrafts, {
    fields: [orders.draftId],
    references: [orderDrafts.id],
  }),
  photos: many(orderPhotos),
  generationAttempts: many(generationAttempts),
  adminActions: many(adminActions),
  messages: many(adminMessages),
  manufacturer: one(manufacturers, {
    fields: [orders.manufacturerId],
    references: [manufacturers.id],
  }),
  manufacturerActions: many(manufacturerActions),
  qcPhotos: many(qcPhotos),
  qcReviews: many(qcReviews),
  orderMessages: many(messages),
  earning: one(manufacturerEarnings),
  invoice: one(invoices),
  disputes: many(disputes),
  product: one(products, {
    fields: [orders.productId],
    references: [products.id],
  }),
  sellerManufacturer: one(manufacturers, {
    fields: [orders.sellerManufacturerId],
    references: [manufacturers.id],
  }),
}));

export const orderPhotosRelations = relations(orderPhotos, ({ one }) => ({
  order: one(orders, {
    fields: [orderPhotos.orderId],
    references: [orders.id],
  }),
}));

export const qcPhotosRelations = relations(qcPhotos, ({ one }) => ({
  order: one(orders, {
    fields: [qcPhotos.orderId],
    references: [orders.id],
  }),
  manufacturer: one(manufacturers, {
    fields: [qcPhotos.manufacturerId],
    references: [manufacturers.id],
  }),
}));

export const qcReviewsRelations = relations(qcReviews, ({ one }) => ({
  order: one(orders, {
    fields: [qcReviews.orderId],
    references: [orders.id],
  }),
}));

export const messagesRelations = relations(messages, ({ one }) => ({
  order: one(orders, {
    fields: [messages.orderId],
    references: [orders.id],
  }),
}));

export const manufacturerEarningsRelations = relations(manufacturerEarnings, ({ one }) => ({
  order: one(orders, {
    fields: [manufacturerEarnings.orderId],
    references: [orders.id],
  }),
  manufacturer: one(manufacturers, {
    fields: [manufacturerEarnings.manufacturerId],
    references: [manufacturers.id],
  }),
  payout: one(payouts, {
    fields: [manufacturerEarnings.payoutId],
    references: [payouts.id],
  }),
}));

export const payoutsRelations = relations(payouts, ({ one, many }) => ({
  manufacturer: one(manufacturers, {
    fields: [payouts.manufacturerId],
    references: [manufacturers.id],
  }),
  earnings: many(manufacturerEarnings),
}));

export const invoicesRelations = relations(invoices, ({ one }) => ({
  order: one(orders, {
    fields: [invoices.orderId],
    references: [orders.id],
  }),
}));

export const manufacturerDocumentsRelations = relations(manufacturerDocuments, ({ one }) => ({
  manufacturer: one(manufacturers, {
    fields: [manufacturerDocuments.manufacturerId],
    references: [manufacturers.id],
  }),
}));

export const disputesRelations = relations(disputes, ({ one }) => ({
  order: one(orders, {
    fields: [disputes.orderId],
    references: [orders.id],
  }),
  user: one(users, {
    fields: [disputes.userId],
    references: [users.id],
  }),
}));

export const customerNotificationsRelations = relations(customerNotifications, ({ one }) => ({
  user: one(users, {
    fields: [customerNotifications.userId],
    references: [users.id],
  }),
  order: one(orders, {
    fields: [customerNotifications.orderId],
    references: [orders.id],
  }),
}));

export const generationAttemptsRelations = relations(
  generationAttempts,
  ({ one, many }) => ({
    order: one(orders, {
      fields: [generationAttempts.orderId],
      references: [orders.id],
    }),
    meshReports: many(meshReports),
  })
);

export const meshReportsRelations = relations(meshReports, ({ one }) => ({
  generation: one(generationAttempts, {
    fields: [meshReports.generationId],
    references: [generationAttempts.id],
  }),
}));

export const adminActionsRelations = relations(adminActions, ({ one }) => ({
  order: one(orders, {
    fields: [adminActions.orderId],
    references: [orders.id],
  }),
}));

export const adminMessagesRelations = relations(adminMessages, ({ one }) => ({
  order: one(orders, {
    fields: [adminMessages.orderId],
    references: [orders.id],
  }),
}));

export const manufacturersRelations = relations(manufacturers, ({ many }) => ({
  orders: many(orders),
  actions: many(manufacturerActions),
  notifications: many(manufacturerNotifications),
  earnings: many(manufacturerEarnings),
  payouts: many(payouts),
  documents: many(manufacturerDocuments),
  products: many(products),
}));

export const productsRelations = relations(products, ({ one, many }) => ({
  manufacturer: one(manufacturers, {
    fields: [products.manufacturerId],
    references: [manufacturers.id],
  }),
  images: many(productImages),
  orders: many(orders),
}));

export const productImagesRelations = relations(productImages, ({ one }) => ({
  product: one(products, {
    fields: [productImages.productId],
    references: [products.id],
  }),
}));

export const manufacturerActionsRelations = relations(manufacturerActions, ({ one }) => ({
  order: one(orders, {
    fields: [manufacturerActions.orderId],
    references: [orders.id],
  }),
  manufacturer: one(manufacturers, {
    fields: [manufacturerActions.manufacturerId],
    references: [manufacturers.id],
  }),
}));

export const manufacturerNotificationsRelations = relations(
  manufacturerNotifications,
  ({ one }) => ({
    manufacturer: one(manufacturers, {
      fields: [manufacturerNotifications.manufacturerId],
      references: [manufacturers.id],
    }),
    order: one(orders, {
      fields: [manufacturerNotifications.orderId],
      references: [orders.id],
    }),
  })
);

// Gift Cards
export const giftCards = pgTable("gift_cards", {
  id: uuid("id").primaryKey().defaultRandom(),
  code: text("code").notNull().unique(),
  theme: giftCardThemeEnum("theme"),
  amountKurus: integer("amount_kurus").notNull(),
  balanceKurus: integer("balance_kurus").notNull(),
  status: giftCardStatusEnum("status").notNull().default("active"),
  buyerUserId: uuid("buyer_user_id").references(() => users.id),
  buyerEmail: text("buyer_email"),
  buyerName: text("buyer_name"),
  note: text("note"),
  maxRedemptions: integer("max_redemptions"), // null = unlimited
  recipientEmail: text("recipient_email"),
  recipientName: text("recipient_name"),
  recipientMessage: text("recipient_message"),
  emailSent: boolean("email_sent").notNull().default(false),
  expiresAt: timestamp("expires_at").notNull(),
  paidAt: timestamp("paid_at"),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

export const giftCardRedemptions = pgTable(
  "gift_card_redemptions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    giftCardId: uuid("gift_card_id")
      .notNull()
      .references(() => giftCards.id),
    orderId: uuid("order_id").references(() => orders.id),
    draftId: uuid("draft_id").references(() => orderDrafts.id),
    amountKurus: integer("amount_kurus").notNull(),
    redeemedByUserId: uuid("redeemed_by_user_id")
      .notNull()
      .references(() => users.id),
    refundedAt: timestamp("refunded_at"),
    createdAt: timestamp("created_at").notNull().defaultNow(),
  },
  (table) => [
    // Partial unique index — guarantees a single draft can have at most one
    // ACTIVE (non-refunded) redemption row. Prevents accidental double-insert
    // that could double-refund a gift card.
    //
    // The `refunded_at IS NULL` predicate is critical: without it, any
    // historical pair (active + refunded) on the same draft would block
    // index creation on existing prod data. With it, refunded rows fall
    // out of the unique scope and only the live ones are constrained.
    uniqueIndex("gift_card_redemptions_draft_id_unique")
      .on(table.draftId)
      .where(
        sql`${table.draftId} IS NOT NULL AND ${table.refundedAt} IS NULL`
      ),
  ]
);

// Gift Card Relations
export const giftCardsRelations = relations(giftCards, ({ one, many }) => ({
  buyer: one(users, {
    fields: [giftCards.buyerUserId],
    references: [users.id],
  }),
  redemptions: many(giftCardRedemptions),
}));

export const giftCardRedemptionsRelations = relations(
  giftCardRedemptions,
  ({ one }) => ({
    giftCard: one(giftCards, {
      fields: [giftCardRedemptions.giftCardId],
      references: [giftCards.id],
    }),
    order: one(orders, {
      fields: [giftCardRedemptions.orderId],
      references: [orders.id],
    }),
    draft: one(orderDrafts, {
      fields: [giftCardRedemptions.draftId],
      references: [orderDrafts.id],
    }),
    redeemedBy: one(users, {
      fields: [giftCardRedemptions.redeemedByUserId],
      references: [users.id],
    }),
  })
);
