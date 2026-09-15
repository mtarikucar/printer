export const dynamic = "force-dynamic";

import { FLAG_LABELS_TR, autoAssignFlagFor, type FlagKey } from "@/lib/config/flags";
import { getAllFlags } from "@/lib/services/flags";
import {
  autoAssignSwitchesFromFlags,
  countPendingSweepOrders,
  loadPendingSweepOrders,
} from "./sweep-data";
import { SWEEP_KIND_LABEL_TR, SWEEP_MAX_LIMIT } from "./types";
import type { AutoAssignOrderKind } from "@/lib/config/flags";
import { AssignmentSweepClient } from "./client";

/**
 * Atama taraması — "üretici bekliyor"da birikmiş siparişleri tek ekranda
 * eritmek için.
 *
 * Sayfa AÇILIRKEN sıralama YAPILMAZ: yalnız bekleyen siparişleri listeler.
 * Tarama (ve dolayısıyla üretici başına puanlama sorguları) admin düğmeye
 * bastığında çalışır, atama ise ancak ayrıca onaylandığında.
 */
export default async function AdminAssignmentSweepPage() {
  // Anahtarlar ÖNCE okunur: her satır kendi türünün otomatik atama anahtarını
  // taşır, çünkü kapalı anahtarlı satırlar seçili gelmez (aşağıdaki uyarıya
  // bakın) ve ekranda ayrı bir onay ister.
  const flags = await getAllFlags();
  const switches = autoAssignSwitchesFromFlags(flags);

  const [total, pending] = await Promise.all([
    countPendingSweepOrders(),
    loadPendingSweepOrders(SWEEP_MAX_LIMIT, switches),
  ]);

  // "Bu siparişler neden birikmiş?" sorusunun en olası cevabı: türünün otomatik
  // atama anahtarı kapalı. Anahtar listesi tür kümesinden türetilir (elle
  // yazılmaz), böylece yeni bir tür eklendiğinde bu uyarı da onu kapsar.
  const offSwitches = (
    Object.keys(SWEEP_KIND_LABEL_TR) as AutoAssignOrderKind[]
  )
    .map((kind) => autoAssignFlagFor(kind))
    .filter((key): key is FlagKey => key !== null)
    .filter((key) => !flags[key])
    .map((key) => FLAG_LABELS_TR[key]);

  return (
    <div className="p-4 sm:p-8 max-w-6xl">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-gray-900">Atama taraması</h1>
        <p className="text-sm text-gray-500 mt-1">
          Üretici bekleyen siparişleri tarar ve her biri için bugünün
          sıralamasına göre hangi üreticiye gideceğini gösterir. Tarama salt
          okunurdur; atama yalnızca seçip onayladığınızda yapılır.
        </p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3 mb-6">
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Üretici bekleyen
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5">{total}</p>
        </div>
        <div className="rounded-lg border border-gray-200 bg-white p-3">
          <p className="text-xs uppercase tracking-wide text-gray-500">
            Bu taramada
          </p>
          <p className="text-2xl font-bold text-gray-900 mt-0.5">
            {Math.min(total, SWEEP_MAX_LIMIT)}
          </p>
          <p className="text-[11px] text-gray-500 mt-0.5">
            En eski {SWEEP_MAX_LIMIT} sipariş
          </p>
        </div>
      </div>

      {offSwitches.length > 0 && (
        <div className="mb-6 rounded-lg border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-medium">Kapalı otomatik atama anahtarları</p>
          <ul className="mt-1 list-disc pl-5 space-y-0.5">
            {offSwitches.map((label) => (
              <li key={label}>{label}</li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-amber-800">
            Bu türlerdeki siparişler listede görünür ve adayları hesaplanır, ama
            &quot;otomatik atama kapalı&quot; olarak işaretlenir: seçili
            gelmezler, &quot;tümünü seç&quot; onları almaz ve atanabilmeleri için
            onay adımında ayrıca kutuyu işaretlemeniz gerekir. Böyle bir atama
            denetim kaydına &quot;anahtar kapalıyken elle atandı&quot; olarak
            düşer.
          </p>
        </div>
      )}

      <AssignmentSweepClient
        pending={pending.map((p) => p.base)}
        total={total}
        scanLimit={SWEEP_MAX_LIMIT}
      />
    </div>
  );
}
