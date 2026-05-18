// N11 — fuzzy reference matching for dekont OCR. Tests
// levenshtein + fuzzyContains directly. These power the "did the
// customer's reference appear in the receipt text" check, which gates
// auto-confirm. Single-character OCR drift (O↔0, I↔l↔1) is the most
// common failure mode we want to absorb.
//
// Run: npx tsx scripts/test-fuzzy-match.ts

import {
  fuzzyContains,
  levenshtein,
} from "../src/lib/services/dekont-ocr";

let pass = 0;
let fail = 0;

function check(name: string, ok: boolean, detail?: string) {
  if (ok) {
    pass++;
    console.log(`✓ ${name}`);
  } else {
    fail++;
    console.log(`✗ ${name}${detail ? ` — ${detail}` : ""}`);
  }
}

// ─── levenshtein basics ──────────────────────────────────────────
check("identical strings → 0", levenshtein("abc", "abc") === 0);
check("empty vs empty → 0", levenshtein("", "") === 0);
check("empty vs 'abc' → 3", levenshtein("", "abc") === 3);
check("'abc' vs empty → 3", levenshtein("abc", "") === 3);
check("single substitution → 1", levenshtein("abc", "abd") === 1);
check("single insertion → 1", levenshtein("abc", "abcd") === 1);
check("single deletion → 1", levenshtein("abcd", "abc") === 1);
check("two operations → 2", levenshtein("kitten", "sittin") === 2);
check("classic kitten/sitting → 3", levenshtein("kitten", "sitting") === 3);

// ─── fuzzyContains — exact substring at 0.85 threshold ───────────
check(
  "exact substring matches",
  fuzzyContains("ORDER FIG-ABC123 PAYMENT", "FIG-ABC123", 0.85)
);

check(
  "needle longer than haystack → false",
  fuzzyContains("FIG", "FIG-ABC123", 0.85) === false
);

check(
  "empty needle → false",
  fuzzyContains("anything", "", 0.85) === false
);

// ─── Single-char OCR drift — the headline use case ───────────────
// O↔0 confusion (OCR misreads zero as letter O or vice versa)
check(
  "O↔0 OCR drift: 'FIG-ABC0123' matches 'FIG-ABCO123' at 0.85",
  fuzzyContains("RECEIPT FIG-ABCO123 PAID", "FIG-ABC0123", 0.85)
);

// I↔1 confusion
check(
  "I↔1 OCR drift: 'FIG-1234' matches 'FIG-I234' at 0.85",
  fuzzyContains("PAYMENT FIG-I234", "FIG-1234", 0.85)
);

// S↔5 confusion
check(
  "S↔5 OCR drift: 'FIG-S00' matches 'FIG-500' at 0.85",
  fuzzyContains("AMOUNT FIG-500", "FIG-S00", 0.85)
);

// ─── Below threshold — should NOT match ──────────────────────────
// Two char errors in a 6-char needle = 2/6 = 33% error rate = 67%
// similarity, below 0.85 threshold.
check(
  "two-char drift below 0.85 → false",
  fuzzyContains("FOOBAR FIQ-AKC", "FIG-ABC", 0.85) === false
);

// Random alphanumeric noise should not look like a reference.
check(
  "random noise doesn't false-positive",
  fuzzyContains("XYZ987QQQ", "FIG-ABC123", 0.85) === false
);

// ─── At-threshold boundary (sanity) ──────────────────────────────
// For needle length 10, threshold 0.85 means max edit distance = 1.5
// → 1 substitution = 0.9 ratio (above 0.85, accept). 2 = 0.8 (reject).
check(
  "10-char needle, 1 substitution accepted",
  fuzzyContains("aaaaXaaaaa", "aaaaaaaaaa", 0.85)
);
check(
  "10-char needle, 2 substitutions rejected",
  fuzzyContains("aaXXaaaaaa", "aaaaaaaaaa", 0.85) === false
);

// ─── Real-world dekont scenario ──────────────────────────────────
// OCR'd dekont with whole sentence around the reference.
const dekontText = "ACIKLAMA FIG-WHZR9LF_ tutar 1399,00 TL";
check(
  "exact reference found in dekont text",
  fuzzyContains(dekontText, "FIG-WHZR9LF_", 0.85)
);

// Single OCR drift on a real order reference
check(
  "OCR drift on real reference (F→E)",
  fuzzyContains(
    "RECEIPT EIG-WHZR9LF tutar 1399,00 TL",
    "FIG-WHZR9LF",
    0.85
  )
);

// Reference not present at all
check(
  "absent reference returns false",
  fuzzyContains("totally unrelated text", "FIG-ABC123", 0.85) === false
);

console.log(`\n${pass}/${pass + fail} fuzzy-match checks passed`);
if (fail > 0) process.exit(1);
