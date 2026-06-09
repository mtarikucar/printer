import Replicate from "replicate";
import { removeBackground } from "./background-removal";

export type FigurineStyle = "realistic" | "disney" | "anime" | "chibi" | "object";
export type StyleModifier = "pixel_art";

// Critical: this clause is appended to every style prompt. It shapes the
// stylized image so that Meshy's image-to-3d step produces a mesh that a
// slicer accepts without manual repair. Avoid words that suggest fragile,
// floating, translucent, or disconnected elements.
const PRINT_READINESS_CLAUSE =
  "Critical requirements for 3D printing: clean unambiguous silhouette, thick solid limbs, " +
  "a single connected piece with no separate floating accessories, no thin protrusions or fragile details, " +
  "feet firmly planted flat on the ground, arms clearly separated from the body with visible gaps between arm and torso, " +
  "no transparent or glass elements, no hair strands or jewelry floating away from the head, " +
  "no swords, wands, staffs, or other thin handheld objects, " +
  "every part of the figure connected to the main body, designed as a sturdy collectible figurine ready for direct 3D printing.";

// Pose phrasing per style. Chibi/Storybook get a strict T-pose (their proportions
// already lean toward static "toy" silhouettes); anime keeps a confident
// standing pose but with arms separated for printability.
const POSE_PHRASE: Record<Exclude<FigurineStyle, "realistic" | "object">, string> = {
  disney: "in a clear T-pose with arms extended horizontally away from the body",
  chibi: "in a clear T-pose with arms extended horizontally away from the body",
  anime: "in a confident standing pose facing forward with arms clearly separated from the body",
};

const STYLE_PROMPTS: Record<Exclude<FigurineStyle, "realistic" | "object">, string> = {
  disney:
    "Reimagine this person as an adorable storybook-animation 3D collectible figurine character. Use their general appearance as loose inspiration but fully transform them into a charming stylized animated character with cute rounded proportions, big warm expressive eyes, a sweet friendly smile, smooth softly-shaded skin, and soft studio lighting. Show the full body " +
    POSE_PHRASE.disney +
    ", like a collectible toy figure. Remove the background completely and replace it with a plain white background. Only include the single character, no other objects. " +
    PRINT_READINESS_CLAUSE,
  anime:
    "Reimagine this person as a beautiful Japanese anime character figurine. Use their general appearance as loose inspiration but fully transform them into an authentic anime character with large detailed anime eyes, stylized colorful anime hair, clean bold cel-shading lines, vibrant colors, and manga-inspired proportions. Show the full body " +
    POSE_PHRASE.anime +
    ", like an anime figure collectible. Remove the background completely and replace it with a plain white background. Only include the single character, no other objects. " +
    PRINT_READINESS_CLAUSE,
  chibi:
    "Reimagine this person as an extremely cute chibi figurine character. Use their general appearance as loose inspiration but prioritize maximum cuteness — an oversized round head taking up nearly half the body, a tiny adorable body, big sparkling kawaii eyes, a sweet little smile, and irresistibly charming proportions. Show the full body " +
    POSE_PHRASE.chibi +
    ", like a chibi collectible figure. Remove the background completely and replace it with a plain white background. Only include the single character, no other objects. " +
    PRINT_READINESS_CLAUSE,
};

const MODIFIER_PROMPTS: Record<StyleModifier, string> = {
  pixel_art:
    "Render in retro 16-bit pixel art style with visible blocky pixels, limited color palette, and nostalgic video game aesthetic. Keep the form blocky but solid with thick voxel-style limbs and no thin pixel-wide details.",
};

function buildPrompt(style: FigurineStyle, modifiers: StyleModifier[]): string | null {
  const hasModifiers = modifiers.length > 0;

  if ((style === "realistic" || style === "object") && !hasModifiers) {
    return null; // Skip Replicate entirely — send directly to Meshy
  }

  if ((style === "realistic" || style === "object") && hasModifiers) {
    // Only modifier prompt, applied to the photo
    const modifierSuffix = modifiers.map((m) => MODIFIER_PROMPTS[m]).join(" ");
    const subject = style === "object" ? "the object" : "the person";
    return `Transform this photo: ${modifierSuffix} Remove the background completely and replace it with a plain white background. Only include ${subject}, no other elements. ${PRINT_READINESS_CLAUSE}`;
  }

  const basePrompt = STYLE_PROMPTS[style as Exclude<FigurineStyle, "realistic" | "object">];

  if (!hasModifiers) {
    return basePrompt;
  }

  // Combine base style + modifier suffix
  const modifierSuffix = modifiers.map((m) => MODIFIER_PROMPTS[m]).join(" ");
  // Insert modifier instruction before the background removal sentence
  const bgSentence = "Remove the background completely";
  const idx = basePrompt.indexOf(bgSentence);
  if (idx !== -1) {
    return basePrompt.slice(0, idx) + modifierSuffix + " " + basePrompt.slice(idx);
  }
  return basePrompt + " " + modifierSuffix;
}

export { buildPrompt, PRINT_READINESS_CLAUSE, POSE_PHRASE };

export async function applyStyleTransfer(
  imageBuffer: Buffer,
  style: FigurineStyle,
  modifiers: StyleModifier[] = []
): Promise<Buffer> {
  const prompt = buildPrompt(style, modifiers);

  if (!prompt) {
    return imageBuffer;
  }

  const replicate = new Replicate();
  const imageUri = `data:image/png;base64,${imageBuffer.toString("base64")}`;

  const output = await replicate.run("black-forest-labs/flux-kontext-pro", {
    input: {
      input_image: imageUri,
      prompt,
      aspect_ratio: "match_input_image",
      output_format: "png",
      safety_tolerance: 2,
    },
  });

  // Output is a single URL or ReadableStream
  let imageUrl: string;
  if (typeof output === "string") {
    imageUrl = output;
  } else if (output instanceof ReadableStream) {
    const chunks: Uint8Array[] = [];
    const reader = output.getReader();
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) chunks.push(value);
    }
    return Buffer.concat(chunks);
  } else if (Array.isArray(output) && output.length > 0) {
    imageUrl = output[0];
  } else {
    throw new Error("Replicate returned unexpected output format");
  }

  const res = await fetch(imageUrl);
  if (!res.ok) {
    throw new Error(`Failed to download stylized image: ${res.status}`);
  }

  const styledBuffer = Buffer.from(await res.arrayBuffer());

  // Remove background so only the character remains
  return removeBackground(styledBuffer);
}
