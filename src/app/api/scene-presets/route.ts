import { NextResponse } from "next/server";
import { listEnabledScenePresets } from "@/lib/services/scene-presets";

// Public list of enabled scene presets for the create-page picker. Only safe,
// display-facing fields are exposed — the English promptFragment stays
// server-side (it's an internal generation detail, edited from the admin panel).
export async function GET() {
  try {
    const presets = await listEnabledScenePresets();
    return NextResponse.json({
      scenePresets: presets.map((p) => ({
        slug: p.slug,
        label: p.label,
        description: p.description,
        peopleHint: p.peopleHint,
      })),
    });
  } catch {
    // Never block the create flow on a scene-list failure — the page falls back
    // to the default single-subject behavior when the list is empty.
    return NextResponse.json({ scenePresets: [] });
  }
}
