"use client";

import { useState } from "react";
import { GalleryCard, type GalleryItem } from "@/components/gallery-card";
import { GalleryModal } from "@/components/gallery-modal";

export function GalleryPreview({ items }: { items: GalleryItem[] }) {
  const [selectedItem, setSelectedItem] = useState<GalleryItem | null>(null);

  return (
    <>
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4 sm:gap-6">
        {items.map((item) => (
          <GalleryCard
            key={item.id}
            item={item}
            onClick={() => setSelectedItem(item)}
          />
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
