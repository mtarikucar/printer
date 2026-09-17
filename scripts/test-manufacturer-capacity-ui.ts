import assert from "node:assert/strict";
import { test } from "node:test";
import { assessSessionRisk } from "../src/lib/config/workshop";
import { createElement, type ComponentProps } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { AppRouterContext } from "next/dist/shared/lib/app-router-context.shared-runtime";
import { SessionClient } from "../src/app/admin/workshops/sessions/[id]/session-client";

const base = {
  daysUntilSession: 30,
  avgPrintDays: 3,
  currentLoad: 6,
  maxConcurrentOrders: 5,
};
const full = { hasRoom: false, loadLabel: "6/5 birim · 2 iş" };

test("shadow-full load warns without claiming a blocked transfer or queue", () => {
  const risk = assessSessionRisk({
    ...base,
    capacity: { ...full, whenFull: "shadow" },
  });
  assert.equal(risk.level, "warn");
  assert.match(risk.message, /gölge/);
  assert.match(risk.message, /6\/5 birim/);
  assert.doesNotMatch(risk.message, /DEVREDİLEMEZ|redded|sıraya girer/);
});

test("shadow-full load does not hide an urgent deadline", () => {
  const risk = assessSessionRisk({
    ...base,
    daysUntilSession: 2,
    capacity: { ...full, whenFull: "shadow" },
  });
  assert.equal(risk.level, "danger");
  assert.match(risk.message, /Yetişmeyebilir/);
  assert.match(risk.message, /gölge/);
});

test("live-full transfer reports rejection while a future session reports queuing", () => {
  const blocked = assessSessionRisk({ ...base, capacity: { ...full, whenFull: "blocked" } });
  const queued = assessSessionRisk({ ...base, capacity: { ...full, whenFull: "queued" } });
  assert.equal(blocked.level, "danger");
  assert.match(blocked.message, /DEVREDİLEMEZ/);
  assert.equal(queued.level, "danger");
  assert.match(queued.message, /Seans yine de açılabilir/);
  assert.doesNotMatch(queued.message, /DEVREDİLEMEZ/);
});

test("server capacity verdict takes precedence over numeric fallback", () => {
  const risk = assessSessionRisk({
    ...base,
    capacity: { ...full, hasRoom: true, whenFull: "blocked" },
  });
  assert.equal(risk.level, "ok");
  assert.doesNotMatch(risk.message, /DEVREDİLEMEZ/);
});

// Render the real client and form controls. Only Next's browser navigation
// is supplied by a provider; no API, database or Redis calls are needed.
const noNavigation = () => { throw new Error("unexpected navigation during render"); };
const router = {
  back: noNavigation, forward: noNavigation, push: noNavigation,
  replace: noNavigation, refresh: noNavigation, prefetch: noNavigation,
  hmrRefresh: noNavigation,
};
const sessionProps: ComponentProps<typeof SessionClient> = {
  session: {
    id: "session", venueName: "Venue", venueAddress: { adres: "Street", ilce: "District", il: "City" },
    startsAt: "2026-10-17T10:00:00Z", durationMinutes: 120,
    capacity: 20, bookedCount: 1, pricePerSeatKurus: 135000,
    manufacturerName: null, commissionRateBps: 1000, status: "closed",
    batchCarrier: null, batchTrackingNumber: null, batchShippedAt: null,
    batchDeliveredAt: null, joinClosesAt: "2026-10-12T10:00:00Z",
    deliverBy: "2026-10-16T10:00:00Z", adminNotes: null,
  },
  participants: [], readyCount: 0, totalCount: 0, missingNames: [],
  netTotalKurus: 0, daysUntilSession: 30, weightedLoadLive: false,
  suggestionBasedOnOrderNumber: null,
  manufacturerOptions: [
    {
      id: "full", companyName: "Full manufacturer", acceptingOrders: true,
      city: null, rank: 1, totalScore: 90, eligible: true, ineligibleReason: null,
      currentLoad: 6, maxConcurrentOrders: 5, hasRoom: false,
      loadLabel: "6/5 birim · 2 iş", avgPrintDays: 3, reasons: [],
    },
    {
      id: "open", companyName: "Open manufacturer", acceptingOrders: true,
      city: null, rank: 2, totalScore: 80, eligible: true, ineligibleReason: null,
      currentLoad: 1, maxConcurrentOrders: 5, hasRoom: true,
      loadLabel: "1/5 birim · 1 iş", avgPrintDays: 3, reasons: [],
    },
  ],
};

function renderSession(overrides: Partial<typeof sessionProps> = {}) {
  return renderToStaticMarkup(createElement(AppRouterContext.Provider,
    { value: router }, createElement(SessionClient, { ...sessionProps, ...overrides })));
}

test("shadow-full top-ranked manufacturer stays selected and assignment stays enabled", () => {
  const html = renderSession();
  assert.match(html, /<option value="full" selected="">/);
  assert.doesNotMatch(html, /TEZGÂH DOLU|devir reddedilir|DEVREDİLEMEZ/);
  assert.match(html, /gölge/);
  const button = html.match(/<button[^>]*>Partiyi bu üreticiye ver<\/button>/)?.[0];
  assert.ok(button);
  assert.doesNotMatch(button, /\sdisabled(?:=|\s|>)/);
});

test("live-full manufacturer is flagged and the next eligible choice is preselected", () => {
  const html = renderSession({ weightedLoadLive: true });
  assert.match(html, /<option value="open" selected="">/);
  assert.match(html, /devir reddedilir/);
  // Manual choice remains available; the service makes the final decision.
  assert.match(html, /<option value="full">/);
});

test("unreadable live load is not presented as full or removed from preselection", () => {
  const html = renderSession({
    weightedLoadLive: true,
    manufacturerOptions: [{ ...sessionProps.manufacturerOptions[0],
      hasRoom: null, currentLoad: null, maxConcurrentOrders: null, loadLabel: null }],
  });
  assert.match(html, /<option value="full" selected="">/);
  assert.doesNotMatch(html, /TEZGÂH DOLU|DEVREDİLEMEZ/);
});
