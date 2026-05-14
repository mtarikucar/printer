import {
  pgTable,
  text,
  timestamp,
  integer,
  jsonb,
  boolean,
  uuid,
  pgEnum,
} from "drizzle-orm/pg-core";
import { relations } from "drizzle-orm";

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
  "assign_manufacturer",
  "mark_havale_paid",
  "mark_payment_expired",
]);

export const figurineSizeEnum = pgEnum("figurine_size", [
  "kucuk",
  "orta",
  "buyuk",
]);

export const figurineStyleEnum = pgEnum("figurine_style", [
  "realistic",
  "disney",
  "anime",
  "chibi",
  "object",
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
  "active",
  "suspended",
]);

export const manufacturerOrderStatusEnum = pgEnum("manufacturer_order_status", [
  "unassigned",
  "assigned",
  "accepted",
  "printing",
  "printed",
  "shipped",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash"),
  googleId: text("google_id"),
  fullName: text("full_name").notNull(),
  phone: text("phone"),
  defaultAddress: jsonb("default_address").$type<TurkishAddress>(),
  createdAt: timestamp("created_at").notNull().defaultNow(),
  updatedAt: timestamp("updated_at").notNull().defaultNow(),
});

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
  email: text("email").notNull(),
  customerName: text("customer_name").notNull(),
  phone: text("phone"),
  figurineSize: figurineSizeEnum("figurine_size").notNull(),
  style: figurineStyleEnum("style").notNull().default("realistic"),
  modifiers: jsonb("modifiers").$type<string[]>(),
  shippingAddress: jsonb("shipping_address").notNull().$type<TurkishAddress>(),
  photoKey: text("photo_key").notNull(),
  locale: text("locale").notNull().default("tr"),
  amountKurus: integer("amount_kurus").notNull(),
  giftCardId: uuid("gift_card_id"), // FK declared in relations to avoid forward-ref cycle
  giftCardAmountKurus: integer("gift_card_amount_kurus").notNull().default(0),
  havaleDiscountKurus: integer("havale_discount_kurus").notNull().default(0),
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
    date?: string;
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
  draftId: uuid("draft_id").references(() => orderDrafts.id),
  email: text("email").notNull(),
  customerName: text("customer_name").notNull(),
  phone: text("phone"),
  figurineSize: figurineSizeEnum("figurine_size").notNull(),
  style: figurineStyleEnum("style").notNull().default("realistic"),
  modifiers: jsonb("modifiers").$type<string[]>(),
  shippingAddress: jsonb("shipping_address").notNull().$type<TurkishAddress>(),
  status: orderStatusEnum("status").notNull().default("paid"),
  locale: text("locale").notNull().default("tr"),
  paymentMethod: paymentMethodEnum("payment_method").notNull(),
  paymentStatus: paymentStatusEnum("payment_status").notNull().default("succeeded"),
  amountKurus: integer("amount_kurus").notNull(),
  havaleDiscountKurus: integer("havale_discount_kurus").notNull().default(0),
  giftCardAmountKurus: integer("gift_card_amount_kurus").notNull().default(0),
  paidAt: timestamp("paid_at").notNull().defaultNow(),
  shippedAt: timestamp("shipped_at"),
  trackingNumber: text("tracking_number"),
  adminNotes: text("admin_notes"),
  failureReason: text("failure_reason"),
  retryCount: integer("retry_count").notNull().default(0),
  isPublic: boolean("is_public").notNull().default(false),
  publicDisplayName: text("public_display_name"),
  publishedAt: timestamp("published_at"),
  galleryCategory: text("gallery_category"),
  galleryTags: jsonb("gallery_tags").$type<string[]>(),
  manufacturerId: uuid("manufacturer_id").references(() => manufacturers.id),
  manufacturerStatus: manufacturerOrderStatusEnum("manufacturer_status"),
  assignedToManufacturerAt: timestamp("assigned_to_manufacturer_at"),
  manufacturerAcceptedAt: timestamp("manufacturer_accepted_at"),
  manufacturerPrintedAt: timestamp("manufacturer_printed_at"),
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
  notes: text("notes"),
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

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  drafts: many(orderDrafts),
  previews: many(previews),
  giftCards: many(giftCards),
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
}));

export const orderPhotosRelations = relations(orderPhotos, ({ one }) => ({
  order: one(orders, {
    fields: [orderPhotos.orderId],
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

export const giftCardRedemptions = pgTable("gift_card_redemptions", {
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
});

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
