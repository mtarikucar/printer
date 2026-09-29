"use client";

import { useState } from "react";

/**
 * Sunucu değeriyle eşitlenen KONTROLLÜ metin alanı.
 *
 * Teklif ekranındaki serbest metin alanları (parça adı, ölçek, parça notu,
 * teklif başlığı, müşteri notu, satın alma emri numarası) `defaultValue` ile
 * yazılmıştı. React 19 değişen bir `defaultValue`'yu HİÇ DOKUNULMAMIŞ alana
 * geçirir, yani "boş bırakılan alan sunucudaki metni siler" senaryosu kendini
 * onarıyordu; kalan gerçek zarar başkaydı: alana bir kez yazıldıktan sonra
 * React onu ömrü boyunca "kirli" sayar ve sunucudan gelen YENİ değeri bir daha
 * içine koymaz. Teklif iki sekmede açıkken bir sekmenin yazdığı not/PO/ölçek,
 * diğer sekmedeki ESKİ değerin üstüne blur'da geri yazılıyordu — sessiz bir
 * "son yazan kazanır" geri alması.
 *
 * Buradaki üç durumlu küçük makine ikisini birden çözer:
 *
 *  - **temiz** (`draft === null`): sunucunun her yeni değeri ekrana geçer
 *    (React 19 davranışının kasıtlı eşdeğeri).
 *  - **yazılıyor** (`draft !== null`, `pending === null`): sunucudan gelen
 *    değer TAŞINMAZ; müşterinin yazdığı metin korunur.
 *  - **gönderildi** (`pending !== null`): yama uçta. Prop hâlâ eski değeri
 *    taşıdığı için alan temiz sayılsaydı ekran bir an eski metne dönerdi. Yama
 *    indiğinde (prop `pending`'e eşitlendiğinde) alan yeniden TEMİZE çıkar,
 *    yani ondan sonraki sunucu değişimlerini yine alır.
 *
 * Durum geçişleri saf fonksiyonlar hâlinde dışa verilir: hook'un kendisi
 * tarayıcı gerektirir, kurallar ise `scripts/test-quote-ui.ts` içinde
 * tarayıcısız sınanır.
 */
export interface SyncedFieldState {
  /** Alanın en son bilinen sunucu değeri. */
  readonly server: string;
  /** Gönderilmemiş metin; `null` ise alana dokunulmamış. */
  readonly draft: string | null;
  /** Sunucuya gönderilen ve inmesi beklenen değer. */
  readonly pending: string | null;
}

/** Temiz alan. */
export function syncedFieldState(server: string): SyncedFieldState {
  return { server, draft: null, pending: null };
}

/** Ekranda gösterilecek metin. */
export function syncedFieldValue(state: SyncedFieldState): string {
  return state.draft ?? state.server;
}

/** Kullanıcı yazdı. */
export function editField(state: SyncedFieldState, draft: string): SyncedFieldState {
  return { server: state.server, draft, pending: null };
}

/**
 * Yazılan değer sunucuya GÖNDERİLDİ. Değer sunucudakiyle aynıysa (blur'da
 * hiçbir şey değişmemiş) yama hiç çıkmaz; alan o hâlde doğrudan temize döner —
 * yoksa bir daha hiçbir sunucu değişimini almazdı.
 */
export function commitField(state: SyncedFieldState, next: string): SyncedFieldState {
  if (next === state.server) return syncedFieldState(state.server);
  return { server: state.server, draft: next, pending: next };
}

/** Sunucudan yeni bir değer geldi (yoklama, SSE, kendi yamamızın cevabı). */
export function syncFromServer(state: SyncedFieldState, server: string): SyncedFieldState {
  // Yama uçtayken prop hâlâ ESKİ değeri taşır; bu dal onu sessizce yutar, yani
  // gönderilen metin ekranda bir an geri sekmez.
  if (server === state.server) return state;
  // Gönderdiğimiz değer indi — ya da BAŞKA biri bizim yazımızın üstüne yazdı.
  // İkisinde de doğruyu sunucu söylüyor: alan temize çıkar ve o değeri gösterir.
  if (state.pending !== null) return syncedFieldState(server);
  // Müşteri yazıyor: sunucunun değeri ekrana TAŞINMAZ, yalnız taban güncellenir
  // ki blur'daki "değişti mi" karşılaştırması taze değerle yapılsın.
  if (state.draft !== null) return { server, draft: state.draft, pending: null };
  return syncedFieldState(server);
}

export interface SyncedField {
  /** `value=` olarak verilecek metin. */
  readonly value: string;
  /** `onChange`: kullanıcı yazdı. */
  readonly edit: (next: string) => void;
  /** `onBlur`: `next` sunucuya gönderildi. */
  readonly commit: (next: string) => void;
  /** Escape / geçersiz giriş: sunucu değerine dön. */
  readonly discard: () => void;
}

export function useSyncedField(serverValue: string): SyncedField {
  const [state, setState] = useState<SyncedFieldState>(() => syncedFieldState(serverValue));
  // Prop değişimine render sırasında uyum: ayrı bir efekte gerek yok ve ekran
  // bir kare boyunca eski değeri göstermez (ev deseni: `QuantityStepper`).
  const synced = syncFromServer(state, serverValue);
  if (synced !== state) setState(synced);

  return {
    value: syncedFieldValue(synced),
    edit: (next) => setState((prev) => editField(prev, next)),
    commit: (next) => setState((prev) => commitField(prev, next)),
    discard: () => setState((prev) => syncedFieldState(prev.server)),
  };
}
