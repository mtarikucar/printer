import Replicate from "replicate";
import { removeBackground } from "./background-removal";
import {
  buildTemplatePrompt,
  PRINT_READINESS_CLAUSE,
  type FigurineStyle,
  type StyleModifier,
  type ScenePromptOptions,
} from "../create/design-templates";

// Style/template definitions now live in the design-template registry
// (src/lib/create/design-templates.ts) — the single source of truth. This
// service only orchestrates the FLUX-Kontext stylization call.
export type { FigurineStyle, StyleModifier };
export { buildTemplatePrompt as buildPrompt, PRINT_READINESS_CLAUSE };

export async function applyStyleTransfer(
  imageBuffer: Buffer,
  style: FigurineStyle,
  modifiers: StyleModifier[] = [],
  scene: ScenePromptOptions = {}
): Promise<Buffer> {
  const prompt = buildTemplatePrompt(style, modifiers, scene);

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
