import Image from "next/image";

export interface MarqueeItem {
  src: string;
  alt: string;
  hasModel?: boolean;
}

export function Marquee({ items }: { items: MarqueeItem[] }) {
  if (items.length === 0) return null;

  // Duplicate for seamless loop
  const allItems = [...items, ...items];

  return (
    <div className="overflow-hidden py-8" aria-hidden="true">
      <div className="marquee-track">
        {allItems.map((item, i) => (
          <div
            key={`${item.src}-${i}`}
            className="flex-shrink-0 mx-3"
          >
            <div
              className={`w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-2 relative ${
                item.hasModel
                  ? "border-green-500 shadow-[0_0_12px_rgba(74,158,104,0.4)]"
                  : "border-bg-subtle"
              }`}
            >
              <Image
                src={item.src}
                alt={item.alt}
                width={96}
                height={96}
                className="w-full h-full object-cover"
              />
              {item.hasModel && (
                <span className="absolute bottom-0 right-0 bg-green-500 text-white text-[8px] font-bold px-1.5 py-0.5 rounded-tl-md">
                  3D
                </span>
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
