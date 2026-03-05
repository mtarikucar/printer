"use client";

import { useState } from "react";
import { FlipGalleryCard } from "@/components/flip-gallery-card";
import type { GalleryItem } from "@/components/gallery-card";
import { GalleryModal } from "@/components/gallery-modal";

export function GalleryPreview({ items }: { items: GalleryItem[] }) {
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);

  return (
    <>
      {/* Masonry layout with CSS columns */}
      <div className="columns-2 md:columns-3 gap-4 sm:gap-6 [&>*]:mb-4 sm:[&>*]:mb-6">
        {items.map((item) => (
          <div key={item.id} className="break-inside-avoid">
            <FlipGalleryCard
              item={item}
              onClick={() => setSelectedItem(item)}
            />
          </div>
        ))}
      </div>
      {selectedItem && (
        <GalleryModal
          item={selectedItem}
          onClose={() => setSelectedItem(null)}
        />
      )}
    </>
  );
}
