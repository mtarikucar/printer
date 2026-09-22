// Shared, isomorphic (client + server safe) realtime event + topic definitions.
// No Node imports here so this module can be bundled into client components.

import type { AnalysisStatus } from "@/lib/config/quote-types";

export type RealtimeEvent =
  | {
      kind: "order";
      orderId: string;
      orderNumber: string;
      status?: string | null;
      manufacturerStatus?: string | null;
      painterStatus?: string | null;
    }
  | { kind: "message"; orderId: string; channel: string; senderType: string }
  | { kind: "notification"; scope: "customer" | "manufacturer" | "painter" }
  // Teklif parçasının analiz durumu değişti. FİYAT VE GEOMETRİ TAŞIMAZ: bu
  // kanal fiyat kapısını tanımaz, arayüz haberi alınca teklifi kendi
  // yetkisiyle yeniden çeker.
  | { kind: "quote_part"; quoteId: string; partId: string; status: AnalysisStatus }
  // Teklifin kendisi değişti (yeniden fiyatlama, admin eylemi, durum geçişi).
  | { kind: "quote"; quoteId: string }
  | { kind: "badge" };

// A connection subscribes to a SET of topics; an event is published with the
// list of topics it should reach. The hub delivers an event to a connection
// when their topic sets intersect.
export const topics = {
  order: (orderId: string) => `order:${orderId}`,
  admin: () => `admin`,
  manufacturer: (manufacturerId: string) => `manufacturer:${manufacturerId}`,
  // Boyacı konusu: üretici konusunun aynısı. Boyacı panelinin de canlı
  // güncellenmesi gerekiyor (yeni model sürümü, boyacı değişimi, admin mesajı).
  painter: (painterId: string) => `painter:${painterId}`,
  customer: (userId: string) => `customer:${userId}`,
  track: (orderNumber: string) => `track:${orderNumber}`,
  // Teklif odası: sahibi (ya da anonim çerez sahibi) açık teklif sayfasında
  // parça analizini canlı izler.
  quote: (quoteId: string) => `quote:${quoteId}`,
};

export interface RealtimeEnvelope {
  topics: string[];
  event: RealtimeEvent;
}

// Single Redis pub/sub channel that bridges every process (web instances +
// BullMQ worker) to the in-process SSE fan-out hubs.
export const REDIS_REALTIME_CHANNEL = "rt:events";
