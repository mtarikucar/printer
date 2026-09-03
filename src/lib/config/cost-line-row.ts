// Shared cost-line row utility — usable from both server and client components.
// Extracted from components/products/cost-lines-editor.tsx to fix the
// "cannot invoke client function from server" boundary error.

import type { CostLineKind } from "./cost-lines";

export interface CostLineRow {
  kind: CostLineKind;
  label: string;
  amountTry: string;
  uid: string;
}

let uidSeq = 0;
const nextUid = () => `cl-${uidSeq++}`;

export const emptyCostLineRow = (): CostLineRow => ({
  kind: "production",
  label: "",
  amountTry: "",
  uid: nextUid(),
});

export const costLineRowFromKurus = (line: {
  kind: CostLineKind;
  label?: string | null;
  amountKurus: number;
}): CostLineRow => ({
  kind: line.kind,
  label: line.label ?? "",
  amountTry: (line.amountKurus / 100).toFixed(2).replace(".", ","),
  uid: nextUid(),
});
