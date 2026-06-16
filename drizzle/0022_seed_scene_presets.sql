-- Custom SQL migration file, put your code below! --

-- Seed the initial scene presets. Idempotent (ON CONFLICT on the unique slug),
-- so re-running migrations never duplicates or clobbers admin edits to existing
-- rows. promptFragment is English (FLUX prompt language); labels are Turkish.
INSERT INTO "scene_presets" ("slug", "label", "description", "prompt_fragment", "people_hint", "sort_order") VALUES
  ('single', 'Tek kişi', 'Fotoğraftaki tek kişi', 'Render only the single main person from the photo as one figurine.', 'single', 0),
  ('family', 'Aile', 'Fotoğraftaki herkes tek tabanda, aile olarak', 'Render all the people shown in the photo together as one family group, standing close to each other on a single shared connected base.', 'multiple', 1),
  ('couple', 'Çift / Sevgili', 'İki kişi, yakın ve sıcak poz', 'Render the two people from the photo together as a couple in a warm, close pose on a single shared connected base.', 'multiple', 2),
  ('friends', 'Arkadaş grubu', 'Herkes, rahat grup dizilişi', 'Render all the people shown in the photo together as a group of friends in a relaxed arrangement, side by side on a single shared connected base.', 'multiple', 3),
  ('graduation', 'Mezuniyet', 'Kep ve cübbeyle (sadeleştirilmiş)', 'Dress the people from the photo in simplified graduation caps and gowns and render them standing together on a single shared connected base; keep each cap as a solid simplified mortarboard shape with no thin tassels or strings.', 'any', 4),
  ('with_pet', 'Evcil hayvanıyla', 'Kişi ve evcil hayvanı tek tabanda', 'Render the person together with their pet from the photo on a single shared connected base, with both firmly connected to the base.', 'any', 5),
  ('custom', 'Serbest tanım', 'Sahneyi kendin tarif et', '', 'any', 6)
ON CONFLICT ("slug") DO NOTHING;
