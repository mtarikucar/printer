import { buildTemplatePrompt as buildPrompt, PRINT_READINESS_CLAUSE, type FigurineStyle, type StyleModifier } from "../src/lib/create/design-templates";
import { buildMeshyBody, poseModeForStyle } from "../src/lib/services/meshy";

const STYLES: FigurineStyle[] = ["realistic", "storybook", "anime", "chibi", "object"];
const MODIFIER_SETS: StyleModifier[][] = [[], ["pixel_art"]];

function divider(title: string) {
  console.log("\n" + "=".repeat(78));
  console.log(title);
  console.log("=".repeat(78));
}

divider("PRINT_READINESS_CLAUSE");
console.log(PRINT_READINESS_CLAUSE);

divider("pose_mode (per style, from design-template registry)");
for (const style of STYLES) {
  console.log(`${style}: ${JSON.stringify(poseModeForStyle(style))}`);
}

divider("Style-transfer prompts (per style + modifier set)");
for (const style of STYLES) {
  for (const mods of MODIFIER_SETS) {
    const tag = `${style}${mods.length ? ` + ${mods.join(",")}` : ""}`;
    console.log(`\n--- ${tag} ---`);
    const prompt = buildPrompt(style, mods);
    if (prompt === null) {
      console.log("(skipped — sent directly to Meshy without style transfer)");
    } else {
      console.log(prompt);
    }
  }
}

divider("Meshy request body (per style)");
for (const style of STYLES) {
  console.log(`\n--- ${style} (pose_mode=${JSON.stringify(poseModeForStyle(style))}) ---`);
  const body = buildMeshyBody("<base64-image-placeholder>", style);
  console.log(JSON.stringify(body, null, 2));
}

console.log("\nDone.");
