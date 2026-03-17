import Replicate from "replicate";
import { removeBackground } from "./background-removal";

export type FigurineStyle = "realistic" | "disney" | "anime" | "chibi";
export type StyleModifier = "pixel_art";

const STYLE_PROMPTS: Record<Exclude<FigurineStyle, "realistic">, string> = {
  disney:
    "Transform this person into a Disney Pixar 3D animated character. Keep the person's face, features, and pose exactly the same but render them in the signature Pixar animation style with smooth colorful skin, big expressive eyes, stylized proportions, and soft studio lighting. Remove the background completely and replace it with a plain white background. Only include the person, no other objects.",
  anime:
    "Transform this person into a Japanese anime character. Keep the person's face, features, and pose exactly the same but render them in anime cel-shading style with clean bold lines, vibrant colors, detailed anime eyes, and manga-inspired shading. Remove the background completely and replace it with a plain white background. Only include the person, no other objects.",
  chibi:
    "Transform this person into a chibi character. Keep the person's recognizable facial features but render them in cute chibi style with an oversized head, tiny body, big round kawaii eyes, and adorable proportions. Remove the background completely and replace it with a plain white background. Only include the character, no other objects.",
};

const MODIFIER_PROMPTS: Record<StyleModifier, string> = {
  pixel_art:
    "Render in retro 16-bit pixel art style with visible blocky pixels, limited color palette, and nostalgic video game aesthetic.",
};

function buildPrompt(style: FigurineStyle, modifiers: StyleModifier[]): string | null {
  const hasModifiers = modifiers.length > 0;

  if (style === "realistic" && !hasModifiers) {
    return null; // Skip Replicate entirely
  }

  if (style === "realistic" && hasModifiers) {
    // Only modifier prompt, applied to the realistic photo
    const modifierSuffix = modifiers.map((m) => MODIFIER_PROMPTS[m]).join(" ");
    return `Transform this photo: ${modifierSuffix} Keep the person's face, features, and pose exactly the same. Remove the background completely and replace it with a plain white background. Only include the person, no other objects.`;
  }

  const basePrompt = STYLE_PROMPTS[style as Exclude<FigurineStyle, "realistic">];

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
