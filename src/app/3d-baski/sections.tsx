import Link from "next/link";
import type { JSX, ReactNode } from "react";
import { mm } from "@/components/quote/format";
import type {
  PricingSnapshot,
  SnapshotMaterial,
  SnapshotTechnology,
} from "@/lib/config/quote-types";
import {
  ANCHOR_BASIS_TR,
  anchorSentence,
  catalogAnchorKurus,
  formatAnchorPrice,
  materialAnchorKurus,
  minOrderSentence,
  technologyAnchorKurus,
} from "./pricing-anchors";

/**
 * `/3d-baski` ve `/3d-baski/malzemeler` sayfalarının GÖVDESİ.
 *
 * Sayfa dosyaları (`page.tsx`) yalnızca veriyi okur (katalog + bayrak) ve
 * buraya verir; çizim işi burada durur. Ayrımın sebebi test edilebilirlik:
 * açılış sayfası bu projenin tek halka açık fiyat yüzeyi ve rakamların
 * katalogdan geldiğini kanıtlayan test (`scripts/test-quote-ui.ts`) bu
 * bileşenleri TOHUM katalogla çizip markup'ta arıyor — `async` bir sayfa
 * bileşeni böyle sınanamazdı.
 *
 * Metinler Türkçe olarak GÖMÜLÜDÜR (ev örneği: `/nasil-calisir`,
 * `/toplu-siparis`). Sözlük müşterinin *uygulama* yüzeyi içindir; pazarlama ve
 * SSS metni tek dilde, cümlenin içindeki rakamla birlikte yazılır.
 *
 * Rakamların hiçbiri elle yazılmaz: baskı hacmi, tolerans, teslim süresi,
 * limitler ve "₺X'ten başlayan" çapası snapshot'tan hesaplanır. Yönetici
 * kataloğu değiştirdiğinde bu sayfa kendiliğinden doğru kalır — yapay zekâ
 * aramasının alıntıladığı rakamın bayatlamaması buna bağlı.
 */

const CONFIDENTIALITY_SENTENCE =
  "Dosyalarınız yalnızca siparişinizi üreten, atanmış üretim ortağıyla paylaşılır.";

// ─── Küçük biçimleyiciler ───────────────────────────────────────────────────

/**
 * Bayt → MB. `components/quote/dropzone` içindeki eşi BİLEREK kopyalandı: o
 * dosya `"use client"` taşıyor ve bir sunucu bileşeni oradan içe aktardığı
 * her şeyi istemci referansı olarak alır — çağrıldığında patlar.
 */
function megabytes(bytes: number): number {
  return Math.round(bytes / (1024 * 1024));
}

function percentFromBps(multiplierBps: number): string {
  return `%${Math.abs(Math.round((multiplierBps - 10000) / 100))}`;
}

function technologyOf(
  snapshot: PricingSnapshot,
  material: SnapshotMaterial
): SnapshotTechnology | null {
  return snapshot.technologies.find((t) => t.key === material.technologyKey) ?? null;
}

/**
 * Malzemenin kütüphane sayfasındaki çapası.
 *
 * Anahtar teknoloji BAŞINA benzersizdir (şema), katalog genelinde değil: iki
 * teknolojide de "pla" olabilir. Aynı `id` iki kez yazılırsa tarayıcı ilkine
 * atlar ve bağlantıların yarısı yanlış malzemeyi gösterir — bu yüzden çakışma
 * varsa teknoloji anahtarı öne eklenir. Bağlantı da, hedef de bu tek
 * fonksiyondan üretilir.
 */
export function materialAnchorId(
  snapshot: PricingSnapshot,
  material: SnapshotMaterial
): string {
  const duplicated = snapshot.materials.filter((m) => m.key === material.key).length > 1;
  return duplicated ? `${material.technologyKey}-${material.key}` : material.key;
}

function materialHref(snapshot: PricingSnapshot, material: SnapshotMaterial): string {
  return `/3d-baski/malzemeler#${materialAnchorId(snapshot, material)}`;
}

/** Malzemenin öne çıkan özellikleri — yalnız katalogda DOLU olanlar. */
function materialFacts(material: SnapshotMaterial): Array<{ label: string; value: string }> {
  const p = material.properties;
  const facts: Array<{ label: string; value: string }> = [];
  if (p.tensileMpa !== undefined) {
    facts.push({ label: "Çekme dayanımı", value: `${mm(p.tensileMpa)} MPa` });
  }
  if (p.elongationPct !== undefined) {
    facts.push({ label: "Kopma uzaması", value: `%${mm(p.elongationPct)}` });
  }
  if (p.heatDeflectionC !== undefined) {
    facts.push({ label: "Isı dayanımı", value: `${mm(p.heatDeflectionC)} °C` });
  }
  facts.push({ label: "Yoğunluk", value: `${mm(material.densityGCm3)} g/cm³` });
  if (p.flexible) facts.push({ label: "Esneklik", value: "Esnek" });
  if (p.transparent) facts.push({ label: "Saydamlık", value: "Şeffaf" });
  return facts;
}

// ─── Sıralı adımlar ─────────────────────────────────────────────────────────

/** Dört adım GERÇEKTEN sıralıdır; numaralandırma bu yüzden bilgi taşır. */
function landingSteps(snapshot: PricingSnapshot): Array<{ title: string; body: string }> {
  const { maxPartsPerQuote, maxFileBytes } = snapshot.settings;
  return [
    {
      title: "Modelini yükle",
      body: `STL, OBJ veya 3MF dosyanızı sürükleyin. Tek teklifte ${maxPartsPerQuote} parçaya, dosya başına ${megabytes(maxFileBytes)} MB'a kadar. Hesap açmadan yükleyebilirsiniz.`,
    },
    {
      title: "Özelliklerini seç",
      body: "Teknoloji, malzeme, renk, yüzey işlemi, katman, doluluk ve adet parça parça seçilir. Her değişiklikte fiyat yeniden hesaplanır.",
    },
    {
      title: "Anında fiyatını gör",
      body: "Birim fiyat, satır toplamı ve adet kademeleri aynı ekranda. Fiyatı görmek için hesap açmanız gerekir; ölçüler, 3B önizleme ve üretim uyarıları girişsiz de görünür.",
    },
    {
      title: "Üretime gönder",
      body: "Kartla ya da havale ile ödeyin. Teklif tek siparişe dönüşür, size atanan üretim ortağına parça listesiyle birlikte düşer ve siparişi baştan sona takip edersiniz.",
    },
  ];
}

// ─── SSS ────────────────────────────────────────────────────────────────────

export interface FaqEntry {
  q: string;
  a: string;
}

/**
 * Sık sorulanlar. Her cevap katalogdaki bir RAKAMLA bağlanır: "hızlı teslim"
 * değil "3 iş günü", "büyük dosya" değil "32 MB". Rakamsız cümle ne müşteriye
 * karar verdirir ne de alıntılanır.
 */
export function landingFaq(snapshot: PricingSnapshot): FaqEntry[] {
  const s = snapshot.settings;
  const economy = s.leadTiers.find((t) => t.key === "economy");
  const express = s.leadTiers.find((t) => t.key === "express");
  const leadSentence = snapshot.technologies
    .map((t) => `${t.name} ${t.baseLeadDays} iş günü`)
    .join(", ");

  const minOrder = minOrderSentence(s.minOrderKurus);

  const tierSentence = [
    economy
      ? `${economy.name} teslim ${economy.daysDelta} iş günü ekler ve fiyatı ${percentFromBps(economy.multiplierBps)} düşürür`
      : null,
    express
      ? `${express.name} teslim ${Math.abs(express.daysDelta)} iş günü kısaltır ve fiyatı ${percentFromBps(express.multiplierBps)} artırır`
      : null,
  ]
    .filter((x): x is string => x !== null)
    .join("; ");

  return [
    {
      q: "Hangi dosya formatlarını yükleyebilirim?",
      a: `STL, OBJ ve 3MF. Tek teklifte en çok ${s.maxPartsPerQuote} parça, dosya başına en çok ${megabytes(s.maxFileBytes)} MB. Ölçü birimini (mm, cm, inç) parça başına değiştirebilirsiniz; 3MF dosyasının kendi birimi varsa otomatik okunur.`,
    },
    // Asgari tutar sıfırlanırsa soru da kalkar: "yok" diyen bir SSS maddesi,
    // olmayan bir kuralı anlatmaktan iyidir.
    ...(minOrder
      ? [
          {
            q: "Asgari sipariş tutarı var mı?",
            a: `${minOrder} Yani ${formatAnchorPrice(s.minOrderKurus)} altında kalan bir sepette aradaki fark "asgari sipariş tamamlaması" satırı olarak eklenir; adet artırmak ya da aynı teklife başka parçalar eklemek bu farkı gerçek üretime çevirir.`,
          },
        ]
      : []),
    {
      q: "Fiyatı görmek için hesap açmam gerekiyor mu?",
      a: "Yükleme, 3B önizleme, ölçüler ve üretilebilirlik uyarıları için gerekmez. Fiyatı görmek için hesap açmanız gerekir: e-posta ve telefonunuzu bir kez verirsiniz, açtığınız teklif de o hesaba bağlanır.",
    },
    {
      q: "Teslim süresi ne kadar?",
      // Kesim saatinin ekine ("14.00'ten") dilbilgisi kuralı sayıya göre
      // değişir; saat katalogdan geldiği için cümle ekten kaçınacak şekilde
      // kuruldu.
      a: `Standart teslim ${leadSentence} olarak başlar; malzeme ve yüzey işlemi bunu uzatabilir. ${tierSentence}. Saat ${s.cutoffHour}.00 sonrasında verilen siparişler ertesi iş gününden sayılır, hafta sonu ve resmî tatiller hesaba katılmaz.`,
    },
    {
      q: "STEP, SOLIDWORKS veya Fusion dosyamı nasıl dışa aktarırım?",
      a: "Anlık fiyat için parçayı CAD programınızdan STL ya da 3MF olarak kaydedin: SOLIDWORKS'te Farklı Kaydet → STL → Seçenekler'den İnce (Fine) çözünürlük, Fusion 360'ta Dosya → Dışa Aktar → STL, Onshape'te sağ tuş → Export → STL. Kaba tesselasyon yüzeyleri köşeli gösterir, ince çözünürlüğü seçin. Dönüştüremiyorsanız dosyayı olduğu gibi gönderip manuel teklif isteyin.",
    },
    {
      q: "Anlık fiyat çıkmazsa ne oluyor?",
      a: "Baskı hacmine sığmayan, boyalı istenen, kritik toleranslı ya da çok yüksek adetli parçalarda motor fiyat vermez. Tek tıkla manuel teklif istersiniz; ekibimiz parçayı inceleyip 24-48 saat içinde parça bazlı fiyat yazar ve teklif aynı ekranda fiyatlanmış olarak açılır.",
    },
    {
      q: "Kurumsal fatura ve PO numarası kullanabilir miyim?",
      a: "Evet. Ödeme adımında fatura türünü kurumsal seçip firma unvanı, VKN ve vergi dairesi girebilir, kendi satın alma (PO) numaranızı yazabilirsiniz; ikisi de teklif belgesinde ve faturada görünür. Teklif ekranındaki anahtarla tutarları KDV hariç de görebilirsiniz.",
    },
    {
      q: "Teklifim ne kadar süre geçerli?",
      a: `Teklif ${s.quoteValidDays} gün geçerlidir; fiyatlar o anki katalogla dondurulur, katalog değişse bile teklifiniz değişmez. Süresi dolan teklifi tek tıkla yeniden fiyatlatabilirsiniz.`,
    },
    {
      q: "Dosyalarım kimlerle paylaşılıyor?",
      a: `${CONFIDENTIALITY_SENTENCE} Paylaşım bağlantısını siz oluşturmadıkça teklifiniz kimseye açılmaz, siparişe dönmeyen tekliflerin dosyaları ise geçerlilik bitiminden ${s.retentionDaysAfterExpiry} gün sonra silinir.`,
    },
  ];
}

// ─── Parçalar ───────────────────────────────────────────────────────────────

function Eyebrow({ children }: { children: ReactNode }): JSX.Element {
  return (
    <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-green-600">
      {children}
    </p>
  );
}

function SectionTitle({ children }: { children: ReactNode }): JSX.Element {
  return (
    <h2
      className="text-2xl text-text-primary md:text-3xl"
      style={{ fontFamily: "var(--font-display)" }}
    >
      {children}
    </h2>
  );
}

/** Bayrak kapalıyken yükleyicinin yerini alan kutu. */
export function ComingSoonNote(): JSX.Element {
  return (
    <div className="rounded-2xl border border-border-default bg-bg-elevated p-6">
      <p className="font-mono text-[11px] uppercase tracking-[0.2em] text-text-muted">
        Yakında
      </p>
      <p className="mt-3 text-sm leading-relaxed text-text-secondary">
        Anlık teklif motoru son testlerinde. Bu arada modelinizi bize gönderin, teklifi
        ekibimiz hazırlayıp aynı gün dönsün.
      </p>
      <Link href="/contact" className="btn-secondary mt-4 inline-flex !px-4 !py-2 text-xs">
        Teklif isteyin
      </Link>
    </div>
  );
}

function TechnologyComparison({ snapshot }: { snapshot: PricingSnapshot }): JSX.Element {
  const techs = snapshot.technologies;
  const rows: Array<{ label: string; cell: (t: SnapshotTechnology) => string }> = [
    {
      label: "Baskı hacmi",
      cell: (t) => `${t.buildMm.x} × ${t.buildMm.y} × ${t.buildMm.z} mm`,
    },
    { label: "Katman", cell: (t) => `${t.layerOptionsUm.join(" / ")} µm` },
    {
      label: "Doluluk",
      cell: (t) =>
        t.infillOptionsPct
          ? `%${t.infillOptionsPct.join(" / %")} (varsayılan %${t.defaultInfillPct})`
          : "Katı baskı",
    },
    { label: "En ince duvar", cell: (t) => `${mm(t.minWallMm)} mm` },
    { label: "En küçük detay", cell: (t) => `${mm(t.minFeatureMm)} mm` },
    { label: "Tolerans", cell: (t) => t.toleranceText },
    { label: "Standart teslim", cell: (t) => `${t.baseLeadDays} iş günü` },
  ];

  return (
    <section className="mx-auto max-w-5xl px-5 py-14 md:py-20">
      <Eyebrow>Teknolojiler</Eyebrow>
      <SectionTitle>Hangi baskı işinizi görür?</SectionTitle>
      <p className="mt-3 max-w-2xl text-text-secondary">
        İki teknoloji de aynı teklifte kullanılabilir; parça parça seçersiniz.
      </p>

      <div className="mt-8 overflow-x-auto">
        <table className="w-full min-w-[34rem] border-collapse text-left text-sm">
          <caption className="sr-only">
            Baskı teknolojilerinin hacim, tolerans, teslim ve başlangıç fiyatı
            karşılaştırması
          </caption>
          <thead>
            <tr>
              <th scope="col" className="w-40 pb-3 pr-4 align-bottom font-medium text-text-muted">
                Özellik
              </th>
              {techs.map((tech) => (
                <th
                  key={tech.key}
                  scope="col"
                  id={tech.key}
                  className="border-b-2 border-ink pb-3 pr-4 align-bottom"
                >
                  <span className="block text-base text-text-primary">{tech.name}</span>
                  <span className="mt-1 block text-xs font-normal leading-snug text-text-secondary">
                    {tech.description}
                  </span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((row) => (
              <tr key={row.label} className="border-b border-bg-subtle">
                <th scope="row" className="py-3 pr-4 font-medium text-text-secondary">
                  {row.label}
                </th>
                {techs.map((tech) => (
                  <td
                    key={tech.key}
                    className="py-3 pr-4 font-mono text-[13px] tabular-nums text-text-primary"
                  >
                    {row.cell(tech)}
                  </td>
                ))}
              </tr>
            ))}
            <tr>
              <th scope="row" className="py-4 pr-4 font-medium text-text-secondary">
                Başlangıç fiyatı
              </th>
              {techs.map((tech) => {
                const kurus = technologyAnchorKurus(snapshot, tech.key);
                return (
                  <td key={tech.key} className="py-4 pr-4">
                    <span className="text-lg font-semibold tracking-tight text-text-primary">
                      {kurus === null ? "Teklifle belirlenir" : anchorSentence(kurus)}
                    </span>
                  </td>
                );
              })}
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs leading-relaxed text-text-muted">
        Başlangıç fiyatları {ANCHOR_BASIS_TR} içindir; gerçek fiyat parçanızın hacmine,
        yüzey alanına, yüksekliğine ve adedine göre hesaplanır.{" "}
        {minOrderSentence(snapshot.settings.minOrderKurus)} Türkiye içi kargo ücretsizdir.
      </p>
    </section>
  );
}

function MaterialCard({
  snapshot,
  material,
}: {
  snapshot: PricingSnapshot;
  material: SnapshotMaterial;
}): JSX.Element {
  const tech = technologyOf(snapshot, material);
  const kurus = materialAnchorKurus(snapshot, material);
  return (
    <li className="flex flex-col rounded-2xl border border-border-default bg-bg-elevated p-5">
      <div className="flex items-baseline justify-between gap-3">
        <h3 className="text-base font-semibold text-text-primary">{material.name}</h3>
        <span className="font-mono text-[11px] uppercase tracking-wider text-text-muted">
          {tech?.name ?? material.technologyKey}
        </span>
      </div>
      <p className="mt-2 flex-1 text-sm leading-relaxed text-text-secondary">
        {material.description}
      </p>
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {material.colors.map((color) => (
          <span
            key={color.key}
            title={color.name}
            className="h-4 w-4 rounded-full border border-bg-subtle"
            style={{ backgroundColor: color.hex }}
          />
        ))}
        <span className="ml-1 text-xs text-text-muted">{material.colors.length} renk</span>
      </div>
      <div className="mt-4 flex items-center justify-between gap-3 border-t border-bg-subtle pt-3">
        <span className="text-sm font-semibold text-text-primary">
          {kurus === null ? "Teklifle belirlenir" : anchorSentence(kurus)}
        </span>
        <Link
          href={materialHref(snapshot, material)}
          className="text-xs font-medium text-green-600 underline-offset-4 hover:underline"
        >
          Teknik özellikler
        </Link>
      </div>
    </li>
  );
}

function MaterialsOverview({ snapshot }: { snapshot: PricingSnapshot }): JSX.Element {
  return (
    <section className="border-y border-border-default bg-bg-surface">
      <div className="mx-auto max-w-5xl px-5 py-14 md:py-20">
        <Eyebrow>Malzemeler</Eyebrow>
        <SectionTitle>{snapshot.materials.length} malzeme, tek teklifte</SectionTitle>
        <p className="mt-3 max-w-2xl text-text-secondary">
          Parça başına malzeme ve renk seçersiniz; fiyat malzemenin yoğunluğu, gram fiyatı
          ve destek payıyla hesaplanır.
        </p>
        <ul className="mt-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {snapshot.materials.map((material) => (
            <MaterialCard key={`${material.technologyKey}-${material.key}`} snapshot={snapshot} material={material} />
          ))}
        </ul>
        <Link
          href="/3d-baski/malzemeler"
          className="mt-6 inline-flex text-sm font-medium text-green-600 underline-offset-4 hover:underline"
        >
          Malzeme kütüphanesinin tamamı
        </Link>
      </div>
    </section>
  );
}

function Steps({ snapshot }: { snapshot: PricingSnapshot }): JSX.Element {
  return (
    <section className="border-t border-border-default">
      <div className="mx-auto max-w-5xl px-5 py-14 md:py-20">
        <Eyebrow>Nasıl çalışır</Eyebrow>
        <SectionTitle>Dosyadan üretime dört adım</SectionTitle>
        <ol className="mt-8 grid gap-6 md:grid-cols-2 lg:grid-cols-4">
          {landingSteps(snapshot).map((step, index) => (
            <li key={step.title} className="border-t-2 border-ink pt-4">
              <span className="font-mono text-xs text-text-muted">{index + 1}</span>
              <h3 className="mt-2 text-base font-semibold text-text-primary">{step.title}</h3>
              <p className="mt-2 text-sm leading-relaxed text-text-secondary">{step.body}</p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}

function Confidentiality({ snapshot }: { snapshot: PricingSnapshot }): JSX.Element {
  return (
    <section className="mx-auto max-w-5xl px-5 pb-14 md:pb-20">
      <div className="rounded-2xl border border-border-default bg-bg-elevated p-6 md:p-8">
        <Eyebrow>Gizlilik</Eyebrow>
        <p
          className="mt-3 max-w-3xl text-lg leading-relaxed text-text-primary"
          style={{ fontFamily: "var(--font-display)" }}
        >
          {CONFIDENTIALITY_SENTENCE}
        </p>
        <ul className="mt-4 grid gap-2 text-sm leading-relaxed text-text-secondary md:grid-cols-3">
          <li>
            Teklifiniz yalnızca size açıktır; paylaşım bağlantısını siz oluşturursunuz ve
            istediğiniz an kapatırsınız.
          </li>
          <li>
            Üretim ortağı yalnızca üreteceği parçaların dosyalarını ve teknik bilgilerini
            görür; müşteri fiyatlarını görmez.
          </li>
          <li>
            Siparişe dönmeyen tekliflerin dosyaları, geçerlilik bitiminden{" "}
            {snapshot.settings.retentionDaysAfterExpiry} gün sonra silinir.
          </li>
        </ul>
      </div>
    </section>
  );
}

function Faq({ snapshot }: { snapshot: PricingSnapshot }): JSX.Element {
  return (
    <section className="border-t border-border-default">
      <div className="mx-auto max-w-3xl px-5 py-14 md:py-20">
        <Eyebrow>Sık sorulanlar</Eyebrow>
        <SectionTitle>Teklif almadan önce</SectionTitle>
        <div className="mt-8 divide-y divide-bg-subtle border-y border-bg-subtle">
          {landingFaq(snapshot).map((entry) => (
            <details key={entry.q} className="group py-4">
              <summary className="flex cursor-pointer list-none items-center justify-between gap-6 text-base font-medium text-text-primary [&::-webkit-details-marker]:hidden">
                {entry.q}
                <span
                  aria-hidden
                  className="font-mono text-lg text-text-muted transition-transform group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="mt-3 text-sm leading-relaxed text-text-secondary">{entry.a}</p>
            </details>
          ))}
        </div>
        <p className="mt-8 text-sm text-text-secondary">
          Başka bir sorunuz mu var?{" "}
          <Link href="/contact" className="text-green-600 underline-offset-4 hover:underline">
            Bize yazın
          </Link>
          , aynı gün dönüyoruz.
        </p>
      </div>
    </section>
  );
}

// ─── Sayfa gövdeleri ────────────────────────────────────────────────────────

/**
 * Açılış sayfasının tamamı. `uploader` bir YUVA: bayrak açıkken istemci
 * yükleyicisi, kapalıyken `ComingSoonNote` gelir. Kapının kendisi `page.tsx`
 * içindedir (oturum okumayı gerektirir), gövde ise her iki durumda da aynı
 * kalır — bayrak, arama motorunun okuduğu sayfayı kapatmaz.
 */
export function PrintServiceLanding({
  snapshot,
  uploader,
}: {
  snapshot: PricingSnapshot;
  uploader: ReactNode;
}): JSX.Element {
  const lowest = catalogAnchorKurus(snapshot);
  const { maxPartsPerQuote, maxFileBytes } = snapshot.settings;

  return (
    <>
      <section className="border-b border-border-default">
        <div className="mx-auto grid max-w-5xl gap-10 px-5 pt-14 pb-12 md:pt-20 lg:grid-cols-[1.05fr_0.95fr] lg:gap-14">
          <div>
            <Eyebrow>ANLIK 3D BASKI TEKLİFİ</Eyebrow>
            <h1
              className="mt-4 text-4xl leading-[1.1] text-text-primary md:text-5xl"
              style={{ fontFamily: "var(--font-display)" }}
            >
              Modelinizi bırakın, fiyatı aynı ekranda görün.
            </h1>
            <p className="mt-5 max-w-xl text-lg leading-relaxed text-text-secondary">
              STL, OBJ veya 3MF dosyanızı yükleyin; ölçüleri, üretilebilirlik uyarılarını ve
              adet kademeli fiyatı dakikalar içinde alın. FDM ve SLA baskı, Türkiye
              genelindeki üretim ortağı ağıyla.
            </p>
            <dl className="mt-8 grid max-w-xl grid-cols-3 gap-4 border-t border-bg-subtle pt-5">
              <div>
                <dt className="text-xs text-text-muted">Başlangıç fiyatı</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums text-text-primary">
                  {lowest === null ? "—" : anchorSentence(lowest)}
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Tek teklifte</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums text-text-primary">
                  {maxPartsPerQuote} parça
                </dd>
              </div>
              <div>
                <dt className="text-xs text-text-muted">Dosya başına</dt>
                <dd className="mt-1 font-mono text-lg tabular-nums text-text-primary">
                  {megabytes(maxFileBytes)} MB
                </dd>
              </div>
            </dl>
            {/* Çapa ile ödeme ekranı arasındaki TEK fark bu cümledir; rakamın
                hemen altında durmazsa "₺74" yanlış bir söz olur. */}
            <p className="mt-3 max-w-xl text-xs leading-relaxed text-text-muted">
              {minOrderSentence(snapshot.settings.minOrderKurus)}
            </p>
          </div>
          <div className="lg:pt-10">{uploader}</div>
        </div>
      </section>

      <Steps snapshot={snapshot} />
      <TechnologyComparison snapshot={snapshot} />
      <MaterialsOverview snapshot={snapshot} />
      <Confidentiality snapshot={snapshot} />
      <Faq snapshot={snapshot} />
    </>
  );
}

/** `/3d-baski/malzemeler` gövdesi: teknolojiye göre gruplanmış malzeme künyeleri. */
export function MaterialLibrary({ snapshot }: { snapshot: PricingSnapshot }): JSX.Element {
  return (
    <>
      <section className="border-b border-border-default">
        <div className="mx-auto max-w-4xl px-5 pt-14 pb-10 md:pt-20">
          <Eyebrow>Malzeme kütüphanesi</Eyebrow>
          <h1
            className="mt-4 text-4xl text-text-primary md:text-5xl"
            style={{ fontFamily: "var(--font-display)" }}
          >
            Hangi malzeme, hangi iş için?
          </h1>
          <p className="mt-5 max-w-2xl text-lg leading-relaxed text-text-secondary">
            Aşağıdaki değerler malzeme üreticilerinin veri sayfalarından alınmıştır ve
            fiyat hesabında da bu değerler kullanılır. Başlangıç fiyatları{" "}
            {ANCHOR_BASIS_TR} içindir. {minOrderSentence(snapshot.settings.minOrderKurus)}
          </p>
          <Link href="/3d-baski" className="btn-primary mt-7 inline-flex !px-5 !py-2.5 text-sm">
            Teklif alın
          </Link>
        </div>
      </section>

      <div className="mx-auto max-w-4xl px-5 py-12 md:py-16">
        {snapshot.technologies.map((tech) => {
          const materials = snapshot.materials.filter((m) => m.technologyKey === tech.key);
          if (materials.length === 0) return null;
          return (
            <section key={tech.key} className="mb-14 last:mb-0">
              <SectionTitle>{tech.name}</SectionTitle>
              <p className="mt-2 max-w-2xl text-sm leading-relaxed text-text-secondary">
                {tech.description} · Baskı hacmi {tech.buildMm.x} × {tech.buildMm.y} ×{" "}
                {tech.buildMm.z} mm · Tolerans {tech.toleranceText}
              </p>

              <div className="mt-6 space-y-5">
                {materials.map((material) => {
                  const kurus = materialAnchorKurus(snapshot, material);
                  return (
                    <article
                      key={material.key}
                      id={materialAnchorId(snapshot, material)}
                      className="scroll-mt-24 rounded-2xl border border-border-default bg-bg-elevated p-6"
                    >
                      <div className="flex flex-wrap items-baseline justify-between gap-3">
                        <h3 className="text-xl text-text-primary" style={{ fontFamily: "var(--font-display)" }}>
                          {material.name}
                        </h3>
                        <span className="text-sm font-semibold text-text-primary">
                          {kurus === null ? "Teklifle belirlenir" : anchorSentence(kurus)}
                        </span>
                      </div>
                      <p className="mt-2 text-sm leading-relaxed text-text-secondary">
                        {material.description}
                      </p>

                      <dl className="mt-5 grid grid-cols-2 gap-x-6 gap-y-3 sm:grid-cols-3">
                        {materialFacts(material).map((fact) => (
                          <div key={fact.label}>
                            <dt className="text-xs text-text-muted">{fact.label}</dt>
                            <dd className="mt-0.5 font-mono text-sm tabular-nums text-text-primary">
                              {fact.value}
                            </dd>
                          </div>
                        ))}
                        <div>
                          <dt className="text-xs text-text-muted">Teslime etkisi</dt>
                          <dd className="mt-0.5 font-mono text-sm tabular-nums text-text-primary">
                            {material.leadDaysExtra === 0
                              ? "Yok"
                              : `+${material.leadDaysExtra} iş günü`}
                          </dd>
                        </div>
                      </dl>

                      {material.properties.uses && material.properties.uses.length > 0 ? (
                        <p className="mt-5 text-sm text-text-secondary">
                          <span className="text-text-muted">Kullanım alanları: </span>
                          {material.properties.uses.join(", ")}
                        </p>
                      ) : null}

                      <ul className="mt-4 flex flex-wrap gap-x-4 gap-y-2">
                        {material.colors.map((color) => (
                          <li key={color.key} className="flex items-center gap-2 text-sm text-text-secondary">
                            <span
                              aria-hidden
                              className="h-4 w-4 rounded-full border border-bg-subtle"
                              style={{ backgroundColor: color.hex }}
                            />
                            {color.name}
                            {color.surchargeKurus > 0 ? (
                              <span className="text-text-muted">
                                +₺{Math.ceil(color.surchargeKurus / 100).toLocaleString("tr-TR")}
                              </span>
                            ) : null}
                          </li>
                        ))}
                      </ul>
                    </article>
                  );
                })}
              </div>
            </section>
          );
        })}
      </div>
    </>
  );
}
