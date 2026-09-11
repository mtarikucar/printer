import assert from "node:assert/strict";
import {
  queueSection,
  type QueueSectionInput,
  type QueueSectionKey,
} from "../src/app/admin/print-queue/sections";

// Manufacturing-queue classifier (src/app/admin/print-queue/sections.ts): every
// order lands in exactly one section. Pure, no DB. The workshop cases pin the
// rule that a QC-approved workshop-session order waits for the admin's batch
// shipment ("workshopBatch"), never in "Kargoya Hazır", because the
// manufacturer ship route refuses workshop orders.

let passed = 0;
const cases: Array<[string, () => void]> = [];

function test(name: string, fn: () => void) {
  cases.push([name, fn]);
}

const base: QueueSectionInput = {
  status: "approved",
  manufacturerStatus: null,
  needsPainting: false,
  painterId: null,
  manufacturerPaintsInHouse: false,
  workshopSessionId: null,
};

function section(name: string, patch: Partial<QueueSectionInput>, want: QueueSectionKey) {
  test(`${name} → ${want}`, () => {
    assert.equal(queueSection({ ...base, ...patch }), want);
  });
}

// ─── Before production ──────────────────────────────────────────
section("approved, no manufacturer", {}, "unassigned");
section("approved, unassigned", { manufacturerStatus: "unassigned" }, "unassigned");
section("paid marketplace, unassigned", { status: "paid", manufacturerStatus: "unassigned" }, "unassigned");
section("paid marketplace, assigned to seller", { status: "paid", manufacturerStatus: "assigned" }, "awaitingAcceptance");

// ─── Production and QC ──────────────────────────────────────────
section("admin self-print (legacy)", { status: "printing", manufacturerStatus: null }, "inProduction");
section("accepted", { manufacturerStatus: "accepted" }, "inProduction");
section("printing", { status: "printing", manufacturerStatus: "printing" }, "inProduction");
section("printed (before QC)", { status: "printing", manufacturerStatus: "printed" }, "qualityCheck");
section("qc_pending", { status: "quality_check", manufacturerStatus: "qc_pending" }, "qualityCheck");
section("qc_rejected", { status: "quality_check", manufacturerStatus: "qc_rejected" }, "qualityCheck");

// ─── After QC: ship or painter ──────────────────────────────────
section("qc_approved, no painting", { status: "quality_check", manufacturerStatus: "qc_approved" }, "readyToShip");
section(
  "qc_approved, painting, external",
  { status: "quality_check", manufacturerStatus: "qc_approved", needsPainting: true },
  "toPainter"
);
section(
  "qc_approved, painting, in-house",
  { status: "quality_check", manufacturerStatus: "qc_approved", needsPainting: true, manufacturerPaintsInHouse: true },
  "readyToShip"
);
section(
  "painter declined (back to quality_check, painter cleared)",
  { status: "quality_check", manufacturerStatus: "qc_approved", needsPainting: true, painterId: null },
  "toPainter"
);
section(
  "with painter",
  { status: "painting", manufacturerStatus: "qc_approved", needsPainting: true, painterId: "p1" },
  "withPainter"
);
section(
  "in-house shop sent to external painter anyway",
  { status: "painting", manufacturerStatus: "qc_approved", needsPainting: true, painterId: "p1", manufacturerPaintsInHouse: true },
  "withPainter"
);
section(
  "painter set but not painting (odd)",
  { status: "quality_check", manufacturerStatus: "qc_approved", needsPainting: true, painterId: "p1" },
  "other"
);
section("quality_check without manufacturer (odd)", { status: "quality_check", manufacturerStatus: null }, "other");

// ─── Workshop-session orders ────────────────────────────────────
// The manufacturer ship route refuses them; the admin ships the whole batch.
section(
  "workshop, qc_approved",
  { status: "quality_check", manufacturerStatus: "qc_approved", workshopSessionId: "s1" },
  "workshopBatch"
);
section(
  "workshop, qc_approved, painting, in-house",
  { status: "quality_check", manufacturerStatus: "qc_approved", workshopSessionId: "s1", needsPainting: true, manufacturerPaintsInHouse: true },
  "workshopBatch"
);
section(
  "workshop, qc_approved, painting, external",
  { status: "quality_check", manufacturerStatus: "qc_approved", workshopSessionId: "s1", needsPainting: true },
  "workshopBatch"
);
section(
  "workshop, accepted at close",
  { status: "approved", manufacturerStatus: "accepted", workshopSessionId: "s1" },
  "inProduction"
);
section(
  "workshop, printing",
  { status: "printing", manufacturerStatus: "printing", workshopSessionId: "s1" },
  "inProduction"
);
section(
  "workshop, qc_pending",
  { status: "quality_check", manufacturerStatus: "qc_pending", workshopSessionId: "s1" },
  "qualityCheck"
);
section(
  "workshop, no manufacturer yet",
  { status: "approved", manufacturerStatus: "unassigned", workshopSessionId: "s1" },
  "unassigned"
);

for (const [name, fn] of cases) {
  try {
    fn();
    passed++;
    console.log(`  ok  ${name}`);
  } catch (err) {
    console.error(`  FAIL  ${name}`);
    console.error(err);
    process.exit(1);
  }
}

console.log(`\n${passed}/${cases.length} passed`);
