import { asc, eq } from "drizzle-orm";
import { db } from "../db";
import { scenePresets } from "../db/schema";

// The "scene" axis is admin-managed and DB-backed (table: scene_presets). This
// service is the single read/seed surface for it; admin CRUD lives in the
// /api/admin/scene-presets routes. Scene drives ONLY the FLUX prompt's
// composition (who is in the figure, how they're arranged) — never price/size.

export type ScenePreset = typeof scenePresets.$inferSelect;

// Slug of the default scene. "single" reproduces the historical single-person
// behavior, so an unset/legacy preview keeps generating exactly as before.
export const DEFAULT_SCENE_SLUG = "single";

// The free-text scene: when selected, the customer's own description is used in
// place of a stored promptFragment.
export const CUSTOM_SCENE_SLUG = "custom";

export interface ScenePresetSeed {
  slug: string;
  label: string;
  description: string;
  promptFragment: string;
  peopleHint: "single" | "multiple" | "any";
  sortOrder: number;
}

// Seed set (also the source the seed migration is generated from). English
// promptFragments match the FLUX prompt language; labels are Turkish (TR-only
// site). Every group scene renders ONE connected piece on a single shared base —
// there is never more than one printed figure.
export const SCENE_PRESET_SEED: ScenePresetSeed[] = [
  {
    slug: "single",
    label: "Tek kişi",
    description: "Fotoğraftaki tek kişi",
    promptFragment:
      "Render only the single main person from the photo as one figurine.",
    peopleHint: "single",
    sortOrder: 0,
  },
  {
    slug: "family",
    label: "Aile",
    description: "Fotoğraftaki herkes tek tabanda, aile olarak",
    promptFragment:
      "Render all the people shown in the photo together as one family group, standing close to each other on a single shared connected base.",
    peopleHint: "multiple",
    sortOrder: 1,
  },
  {
    slug: "couple",
    label: "Çift / Sevgili",
    description: "İki kişi, yakın ve sıcak poz",
    promptFragment:
      "Render the two people from the photo together as a couple in a warm, close pose on a single shared connected base.",
    peopleHint: "multiple",
    sortOrder: 2,
  },
  {
    slug: "friends",
    label: "Arkadaş grubu",
    description: "Herkes, rahat grup dizilişi",
    promptFragment:
      "Render all the people shown in the photo together as a group of friends in a relaxed arrangement, side by side on a single shared connected base.",
    peopleHint: "multiple",
    sortOrder: 3,
  },
  {
    slug: "graduation",
    label: "Mezuniyet",
    description: "Kep ve cübbeyle (sadeleştirilmiş)",
    promptFragment:
      "Dress the people from the photo in simplified graduation caps and gowns and render them standing together on a single shared connected base; keep each cap as a solid simplified mortarboard shape with no thin tassels or strings.",
    peopleHint: "any",
    sortOrder: 4,
  },
  {
    slug: "with_pet",
    label: "Evcil hayvanıyla",
    description: "Kişi ve evcil hayvanı tek tabanda",
    promptFragment:
      "Render the person together with their pet from the photo on a single shared connected base, with both firmly connected to the base.",
    peopleHint: "any",
    sortOrder: 5,
  },
  {
    slug: CUSTOM_SCENE_SLUG,
    label: "Serbest tanım",
    description: "Sahneyi kendin tarif et",
    promptFragment: "",
    peopleHint: "any",
    sortOrder: 6,
  },
];

/** Enabled presets ordered for the picker (create page + public API). */
export async function listEnabledScenePresets(): Promise<ScenePreset[]> {
  return db
    .select()
    .from(scenePresets)
    .where(eq(scenePresets.enabled, true))
    .orderBy(asc(scenePresets.sortOrder));
}

/** All presets (admin list), including disabled. */
export async function listAllScenePresets(): Promise<ScenePreset[]> {
  return db.select().from(scenePresets).orderBy(asc(scenePresets.sortOrder));
}

/** Lookup by slug. Returns null when missing. */
export async function getScenePreset(slug: string): Promise<ScenePreset | null> {
  const [row] = await db
    .select()
    .from(scenePresets)
    .where(eq(scenePresets.slug, slug))
    .limit(1);
  return row ?? null;
}
