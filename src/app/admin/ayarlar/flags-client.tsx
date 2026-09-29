"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AI_SPEND_FLAG_KEYS,
  FLAG_KEY_GROUPS,
  FLAG_KEYS,
  FLAG_LABELS_TR,
  flagGroupCount,
  type FlagKey,
} from "@/lib/config/flags";

/**
 * Bayrak anahtarları — KÜMESİYLE BİRLİKTE.
 *
 * Gruplar `flags.ts`teki `FLAG_KEY_GROUPS`tan okunur, burada yeniden
 * listelenmez: dördüncü bir grup eklendiği gün bu ekran onu kendiliğinden
 * gösterir. Kopyalanmış bir liste, yeni bir anahtarın ekranda hiç görünmemesi
 * demekti — ve görünmeyen bir anahtar, kimsenin açamadığı bir özelliktir.
 */
type FlagGroupName = keyof typeof FLAG_KEY_GROUPS;

const GROUP_LABELS: Record<FlagGroupName, { title: string; note: string }> = {
  feature: {
    title: "Ürün yüzeyleri",
    note: "Müşteriye hangi özelliğin açık olduğunu belirler. Kapalıyken yüzey yalnız admin oturumuna görünür (iç test).",
  },
  spend: {
    title: "Harcama ve yapay zekâ",
    note: "Dışarıya para harcayan ya da müşteriye yapay zekâ çıktısı gönderen her şey. Acil durum anahtarı (AI_KILL_ALL) yalnız bunları kapatır.",
  },
  routing: {
    title: "Otomatik yönlendirme",
    note: "Siparişin üreticiye/boyacıya kendiliğinden atanması. Para harcamaz; kapatıldığında atamayı admin elle yapar.",
  },
};

/**
 * Ekrandaki sıra bir TERCİHTİR, kapı değildir.
 *
 * Gösterilecek grupların listesi `FLAG_KEY_GROUPS`tan TÜRETİLİR: elle yazılmış
 * bir liste, dördüncü bir grup eklendiği gün o grubun ekranda hiç görünmemesi
 * demekti — ve görünmeyen bir anahtar, kimsenin açamadığı bir özelliktir.
 * Aşağıdaki liste yalnız bugünkü üç grubun okuma sırasını korur (önce müşteriye
 * açık yüzeyler); listede olmayan her grup peşine kendiliğinden eklenir.
 * `satisfies` sayesinde buradaki bir ad `flags.ts`ten kalkarsa derleme düşer,
 * yani liste asla var olmayan bir gruba işaret edemez.
 */
const PREFERRED_GROUP_ORDER = [
  "feature",
  "spend",
  "routing",
] as const satisfies readonly FlagGroupName[];

const GROUP_ORDER: FlagGroupName[] = [
  ...PREFERRED_GROUP_ORDER,
  ...(Object.keys(FLAG_KEY_GROUPS) as FlagGroupName[]).filter(
    (group) => !(PREFERRED_GROUP_ORDER as readonly string[]).includes(group)
  ),
];

/**
 * Hiçbir gruba girmemiş anahtarlar.
 *
 * `test-ops-spine` her anahtarın TAM OLARAK bir grupta olmasını şart koşuyor,
 * yani bu liste sağlıklı bir depoda BOŞTUR. Yine de yazılır: bu sayfa bir
 * anahtarı açmanın TEK yolu ve gruplara göre çizildiği için, gruplandırması
 * unutulmuş bir anahtar aksi hâlde ekranda hiç görünmez — yani kimsenin
 * açamadığı bir özellik olur.
 */
const UNGROUPED_KEYS = FLAG_KEYS.filter((key) => flagGroupCount(key) !== 1);

export function FlagsClient({
  flags,
  killAll,
}: {
  flags: Record<FlagKey, boolean>;
  killAll: boolean;
}) {
  const router = useRouter();
  const [busyKey, setBusyKey] = useState<FlagKey | null>(null);
  const [error, setError] = useState<string | null>(null);

  const toggle = async (key: FlagKey, enabled: boolean) => {
    setBusyKey(key);
    setError(null);
    try {
      const response = await fetch("/api/admin/flags", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ key, enabled }),
      });
      if (!response.ok) {
        const body = (await response.json().catch(() => ({}))) as { error?: string };
        setError(body.error ?? `İşlem tamamlanamadı (HTTP ${response.status}).`);
        return;
      }
      router.refresh();
    } finally {
      setBusyKey(null);
    }
  };

  const renderKey = (key: FlagKey) => {
    const forcedOff = killAll && (AI_SPEND_FLAG_KEYS as readonly FlagKey[]).includes(key);
    return (
      <li key={key} className="flex flex-wrap items-center gap-3">
        <label className="flex items-center gap-3">
          <input
            type="checkbox"
            checked={flags[key]}
            disabled={busyKey !== null}
            onChange={(e) => toggle(key, e.target.checked)}
            className="h-4 w-4"
          />
          <span className="text-sm text-gray-900">{FLAG_LABELS_TR[key]}</span>
        </label>
        <code className="rounded bg-gray-100 px-1.5 py-0.5 text-xs text-gray-600">{key}</code>
        {forcedOff && (
          <span className="rounded-full bg-red-100 px-2 py-0.5 text-xs text-red-700">
            acil durumda kapalı
          </span>
        )}
        {busyKey === key && <span className="text-xs text-gray-400">kaydediliyor…</span>}
      </li>
    );
  };

  return (
    <div className="mt-6 max-w-3xl space-y-6">
      {error && (
        <div className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
          {error}
        </div>
      )}

      {killAll && (
        <div className="rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm text-red-800">
          <strong>AI_KILL_ALL açık.</strong> Harcama anahtarları tabloda &quot;açık&quot; yazsa
          bile kapalı davranıyor. Kapatmak için ortam değişkenini kaldırıp süreçleri yeniden
          başlatın.
        </div>
      )}

      {GROUP_ORDER.map((group) => (
        <section key={group} className="rounded-xl border border-gray-200 bg-white p-5">
          <h2 className="text-base font-semibold text-gray-900">{GROUP_LABELS[group].title}</h2>
          <p className="mt-1 text-xs text-gray-500">{GROUP_LABELS[group].note}</p>

          <ul className="mt-4 space-y-3">{FLAG_KEY_GROUPS[group].map(renderKey)}</ul>
        </section>
      ))}

      {UNGROUPED_KEYS.length > 0 && (
        <section className="rounded-xl border border-amber-300 bg-amber-50 p-5">
          <h2 className="text-base font-semibold text-amber-900">Gruplanmamış anahtarlar</h2>
          <p className="mt-1 text-xs text-amber-800">
            Bu anahtarlar <code>FLAG_KEY_GROUPS</code> içinde tam olarak bir gruba
            konmamış. Yine de buradan açılıp kapanabilirler; grubu düzeltin.
          </p>
          <ul className="mt-4 space-y-3">{UNGROUPED_KEYS.map(renderKey)}</ul>
        </section>
      )}
    </div>
  );
}
