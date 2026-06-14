// Equivalence + consistency smoke for the design-template registry.
// Run: npx tsx scripts/_smoke-templates.ts
import { buildPrompt } from "../src/lib/services/style-transfer";
import {
  DESIGN_TEMPLATES,
  TEMPLATE_SLUGS,
  buildTemplatePrompt,
  priceKindForStyle,
  poseModeForStyle,
  getTemplate,
  type StyleModifier,
} from "../src/lib/create/design-templates";

let fails = 0;
const eq = (name: string, a: unknown, b: unknown) => {
  if (JSON.stringify(a) !== JSON.stringify(b)) {
    fails++;
    console.error(`✗ ${name}\n   old: ${JSON.stringify(a)}\n   new: ${JSON.stringify(b)}`);
  } else {
    console.log(`✓ ${name}`);
  }
};

const slugs = ["realistic", "storybook", "anime", "chibi", "object"] as const;
const modSets: StyleModifier[][] = [[], ["pixel_art"]];

// 1) prompt equivalence: new registry must match the legacy buildPrompt exactly.
for (const s of slugs) {
  for (const mods of modSets) {
    eq(
      `prompt ${s} [${mods.join(",")}]`,
      buildPrompt(s as never, mods),
      buildTemplatePrompt(s, mods)
    );
  }
}

// 2) pose-mode parity with the legacy meshy mapping (t-pose for storybook/chibi).
const legacyPose = (s: string) => (s === "storybook" || s === "chibi" ? "t-pose" : "");
for (const s of slugs) eq(`poseMode ${s}`, legacyPose(s), poseModeForStyle(s));

// 3) price-kind parity (only object is "object").
for (const s of slugs) eq(`priceKind ${s}`, s === "object" ? "object" : "figure", priceKindForStyle(s));

// 4) every template resolves a preview path + label/desc keys + enabled.
for (const t of DESIGN_TEMPLATES) {
  if (!t.preview.startsWith("/examples/") || !t.labelKey || !t.descKey) {
    fails++;
    console.error(`✗ template ${t.slug} missing preview/label/desc`);
  }
}

// 5) TEMPLATE_SLUGS round-trips through getTemplate.
for (const s of TEMPLATE_SLUGS) if (!getTemplate(s)) { fails++; console.error(`✗ getTemplate(${s}) null`); }

console.log(fails === 0 ? "\nALL TEMPLATE SMOKE CHECKS PASS" : `\n${fails} FAILURE(S)`);
process.exit(fails === 0 ? 0 : 1);
