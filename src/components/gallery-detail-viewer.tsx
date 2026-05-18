"use client";

import { ModelViewer } from "@/components/model-viewer";
import { BeforeAfterSlider } from "@/components/before-after-slider";
import { useDictionary } from "@/lib/i18n/locale-context";

/**
 * Hero block on /gallery/[slug]. Mirrors the gallery modal but inline.
 * Server component above passes already-normalized URLs.
 */
export function GalleryDetailViewer({
  thumbnailUrl,
  glbUrl,
  name,
}: {
  thumbnailUrl: string | null;
  glbUrl: string | null;
  name: string;
}) {
  const d = useDictionary();
  const hasBoth = !!thumbnailUrl && !!glbUrl;

  return (
    <div className="card overflow-hidden">
      <div className="aspect-square md:aspect-[4/3] bg-bg-elevated">
        {hasBoth ? (
          <BeforeAfterSlider
            before={
              <div className="w-full h-full bg-bg-elevated">
                <img
                  src={thumbnailUrl!}
                  alt={name}
                  className="w-full h-full object-contain"
                />
              </div>
            }
            after={<ModelViewer url={glbUrl!} className="w-full h-full" />}
            beforeLabel={d["gallery.modal.originalPhoto"]}
            afterLabel={d["gallery.modal.yourFigurine"]}
          />
        ) : glbUrl ? (
          <ModelViewer url={glbUrl} className="w-full h-full" />
        ) : thumbnailUrl ? (
          <img
            src={thumbnailUrl}
            alt={name}
            className="w-full h-full object-contain"
          />
        ) : null}
      </div>
    </div>
  );
}
