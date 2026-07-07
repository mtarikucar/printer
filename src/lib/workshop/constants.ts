// Shared, PURE constants for the Workshop Request ("Atölye Talebi") feature.
//
// This module has NO server-only imports so it can be pulled into both the
// client form component and server API/admin code. It defines the option sets
// (venue type, age group, workshop type) and the status lifecycle metadata,
// plus small label helpers. venueType/ageGroup/workshopType are stored as
// `text` (validated against these sets) rather than pg enums because they are
// product-defined and likely to evolve; only `status` is a real pg enum.

export interface Option {
  readonly value: string;
  readonly label: string;
}

// ─── Mekân türü ─────────────────────────────────────────────────────────────
export const WORKSHOP_VENUE_TYPES: readonly Option[] = [
  { value: "cafe", label: "Kafe" },
  { value: "restaurant", label: "Restoran" },
  { value: "school", label: "Okul" },
  { value: "kindergarten", label: "Anaokulu / Kreş" },
  { value: "corporate", label: "Kurumsal / Ofis" },
  { value: "event_hall", label: "Etkinlik salonu" },
  { value: "home", label: "Ev" },
  { value: "other", label: "Diğer" },
] as const;

// ─── Yaş grubu ──────────────────────────────────────────────────────────────
export const WORKSHOP_AGE_GROUPS: readonly Option[] = [
  { value: "kids", label: "Çocuk (4-12)" },
  { value: "teens", label: "Genç (13-17)" },
  { value: "adults", label: "Yetişkin (18+)" },
  { value: "mixed", label: "Karışık" },
] as const;

// ─── Etkinlik / atölye türü ─────────────────────────────────────────────────
export const WORKSHOP_TYPES: readonly Option[] = [
  { value: "birthday", label: "Doğum günü" },
  { value: "corporate", label: "Kurumsal / takım etkinliği" },
  { value: "school", label: "Okul / sınıf etkinliği" },
  { value: "private_group", label: "Özel grup" },
  { value: "other", label: "Diğer" },
] as const;

// ─── Durum yaşam döngüsü ────────────────────────────────────────────────────
// Order matters: first value ("new") is the DB default. `badge` maps to the
// admin status-pill Tailwind classes (same convention as manufacturers-client).
export interface StatusMeta {
  readonly value: string;
  readonly label: string;
  readonly badge: string;
}

// Literal tuple = SINGLE SOURCE OF TRUTH for the status set, so `z.enum` infers
// the exact union and it stays assignable to the pg-enum column type. Order
// matters: first value ("new") is the DB default. Must mirror the
// `workshop_request_status` pg enum in schema.ts / migration 0028.
export const WORKSHOP_STATUS_VALUES = [
  "new",
  "reviewing",
  "scheduled",
  "completed",
  "rejected",
  "cancelled",
] as const;
export type WorkshopStatus = (typeof WORKSHOP_STATUS_VALUES)[number];

// Per-status metadata. Typing it as Record<WorkshopStatus, …> forces exactly-all
// coverage at COMPILE TIME — adding/removing a status value without updating the
// metadata (or vice-versa) is a type error, so the two can never drift.
const WORKSHOP_STATUS_META: Record<WorkshopStatus, { label: string; badge: string }> = {
  new: { label: "Yeni", badge: "bg-amber-100 text-amber-700" },
  reviewing: { label: "İnceleniyor", badge: "bg-blue-100 text-blue-700" },
  scheduled: { label: "Planlandı", badge: "bg-green-100 text-green-700" },
  completed: { label: "Tamamlandı", badge: "bg-emerald-100 text-emerald-700" },
  rejected: { label: "Reddedildi", badge: "bg-gray-200 text-gray-600" },
  cancelled: { label: "İptal edildi", badge: "bg-gray-200 text-gray-600" },
};

// Derived from the tuple (badge = admin status-pill Tailwind classes, same
// convention as manufacturers-client).
export const WORKSHOP_STATUSES: readonly StatusMeta[] = WORKSHOP_STATUS_VALUES.map(
  (value) => ({ value, ...WORKSHOP_STATUS_META[value] })
);

// Value arrays for zod validation (z.enum needs a non-empty tuple).
function values<T extends readonly Option[]>(opts: T): [string, ...string[]] {
  return opts.map((o) => o.value) as [string, ...string[]];
}

export const WORKSHOP_VENUE_TYPE_VALUES = values(WORKSHOP_VENUE_TYPES);
export const WORKSHOP_AGE_GROUP_VALUES = values(WORKSHOP_AGE_GROUPS);
export const WORKSHOP_TYPE_VALUES = values(WORKSHOP_TYPES);

// Label lookups (fall back to the raw value so unknown/legacy values still show).
function labelFor(opts: readonly Option[] | readonly StatusMeta[], v: string): string {
  return opts.find((o) => o.value === v)?.label ?? v;
}

export const venueTypeLabel = (v: string) => labelFor(WORKSHOP_VENUE_TYPES, v);
export const ageGroupLabel = (v: string) => labelFor(WORKSHOP_AGE_GROUPS, v);
export const workshopTypeLabel = (v: string) => labelFor(WORKSHOP_TYPES, v);

export function workshopStatusMeta(v: string): StatusMeta {
  return (
    WORKSHOP_STATUSES.find((s) => s.value === v) ?? {
      value: v,
      label: v,
      badge: "bg-gray-100 text-gray-700",
    }
  );
}

// Human-friendly reference, e.g. "WS-3F7K2Q". Ambiguous chars (0/O, 1/I) omitted.
const REF_ALPHABET = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
export function generateWorkshopReference(): string {
  let code = "";
  for (let i = 0; i < 6; i++) {
    code += REF_ALPHABET[Math.floor(Math.random() * REF_ALPHABET.length)];
  }
  return `WS-${code}`;
}
