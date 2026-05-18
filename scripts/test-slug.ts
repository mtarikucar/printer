// Q3 — pure-logic tests for the kebabify helper in slug.ts.
//
// generateGallerySlug itself requires DB access (collision check) so we
// don't unit-test it here. The kebabify export is what we lock down,
// since review I1 found this was locale-fragile pre-fix.
//
// Run: npx tsx scripts/test-slug.ts

import { kebabify } from "../src/lib/services/slug";

let pass = 0;
let fail = 0;

function check(name: string, actual: string, expected: string) {
  if (actual === expected) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}\n    got:  ${JSON.stringify(actual)}\n    want: ${JSON.stringify(expected)}`);
  }
}

// ─── Basic ASCII ─────────────────────────────────────────────────
check("simple ascii lowercase", kebabify("hello"), "hello");
check("uppercase folded", kebabify("HELLO"), "hello");
check("with spaces → dashes", kebabify("Hello World"), "hello-world");
check("multiple spaces collapsed", kebabify("a   b"), "a-b");
check("trailing/leading dashes stripped", kebabify("---hello---"), "hello");
check("special chars → dashes", kebabify("foo@bar.com"), "foo-bar-com");

// ─── Turkish characters (the I1 fix) ─────────────────────────────
// Lowercase Turkish letters
check("ı → i (lowercase dotless)", kebabify("kınalı"), "kinali");
check("ş → s", kebabify("şahane"), "sahane");
check("ğ → g", kebabify("ağaç"), "agac");
check("ç → c", kebabify("çocuk"), "cocuk");
check("ö → o", kebabify("öğretmen"), "ogretmen");
check("ü → u", kebabify("üzgün"), "uzgun");

// UPPERCASE Turkish letters — the critical pre-fix case. Doing
// .toLowerCase() first relied on locale-correct behavior; the fix
// substitutes both cases BEFORE lowercasing.
check("İ → i (uppercase dotted)", kebabify("İstanbul"), "istanbul");
check("Ş → s", kebabify("Şükran"), "sukran");
check("Ğ → g", kebabify("Ğ"), "g");
check("Ç → c", kebabify("Çocuk"), "cocuk");
check("Ö → o", kebabify("Ömer"), "omer");
check("Ü → u", kebabify("Ümit"), "umit");

// Mixed case + multi-word real names
check(
  "real-name 1: Ayşe Yılmaz",
  kebabify("Ayşe Yılmaz"),
  "ayse-yilmaz"
);
check(
  "real-name 2: Şükran İçen",
  kebabify("Şükran İçen"),
  "sukran-icen"
);
check(
  "real-name 3: Çağrı Öztürk",
  kebabify("Çağrı Öztürk"),
  "cagri-ozturk"
);

// ─── Length cap ──────────────────────────────────────────────────
const longName = "a".repeat(100);
const slugged = kebabify(longName);
check(
  `60-char cap (100 a's → 60 a's)`,
  slugged.length === 60 ? "len=60" : `len=${slugged.length}`,
  "len=60"
);

// ─── Combined: display name + order number pattern ───────────────
// The real generateGallerySlug joins these with a dash. Verify the
// component kebabify produces clean parts.
check(
  "order number: FIG-ABC123LF_",
  kebabify("FIG-ABC123LF_"),
  "fig-abc123lf"
);
check(
  "underscore trailing stripped",
  kebabify("FIG-ABC___"),
  "fig-abc"
);

// ─── Edge cases ──────────────────────────────────────────────────
check("empty string → empty", kebabify(""), "");
check("only special chars → empty", kebabify("@#$%"), "");
check(
  "numbers preserved",
  kebabify("Order #12345"),
  "order-12345"
);
check(
  "diacritics from other locales (NFD strip)",
  kebabify("café"),
  "cafe"
);
check(
  "diacritics: naïve",
  kebabify("naïve"),
  "naive"
);

console.log(`\n${pass}/${pass + fail} slug checks passed`);
if (fail > 0) process.exit(1);
