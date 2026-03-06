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

export interface TurkishAddress {
  adres: string;
  mahalle?: string;
  ilce: string;
  il: string;
  postaKodu: string;
  telefon: string;
}

export const orderStatusEnum = pgEnum("order_status", [
  "pending_payment",
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
]);

export const figurineSizeEnum = pgEnum("figurine_size", [
  "kucuk",
  "orta",
  "buyuk",
]);

export const previewStatusEnum = pgEnum("preview_status", [
  "generating",
  "ready",
  "failed",
  "approved",
  "revision_requested",
  "expired",
]);

export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
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

export const orders = pgTable("orders", {
  id: uuid("id").primaryKey().defaultRandom(),
  orderNumber: text("order_number").notNull().unique(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id),
  previewId: uuid("preview_id").references(() => previews.id),
  email: text("email").notNull(),
  customerName: text("customer_name").notNull(),
  phone: text("phone"),
  figurineSize: figurineSizeEnum("figurine_size").notNull(),
  shippingAddress: jsonb("shipping_address").notNull().$type<TurkishAddress>(),
  status: orderStatusEnum("status").notNull().default("pending_payment"),
  paytrMerchantOid: text("paytr_merchant_oid"),
  amountKurus: integer("amount_kurus").notNull(),
  paidAt: timestamp("paid_at"),
  shippedAt: timestamp("shipped_at"),
  trackingNumber: text("tracking_number"),
  adminNotes: text("admin_notes"),
  failureReason: text("failure_reason"),
  retryCount: integer("retry_count").notNull().default(0),
  isPublic: boolean("is_public").notNull().default(false),
  publicDisplayName: text("public_display_name"),
  publishedAt: timestamp("published_at"),
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

// Relations
export const usersRelations = relations(users, ({ many }) => ({
  orders: many(orders),
  previews: many(previews),
}));

export const previewsRelations = relations(previews, ({ one }) => ({
  user: one(users, { fields: [previews.userId], references: [users.id] }),
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
  photos: many(orderPhotos),
  generationAttempts: many(generationAttempts),
  adminActions: many(adminActions),
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
