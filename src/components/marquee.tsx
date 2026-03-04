import Image from "next/image";

interface MarqueeItem {
  src: string;
  alt: string;
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
            <div className="w-20 h-20 md:w-24 md:h-24 rounded-full overflow-hidden border-2 border-bg-subtle">
              <Image
                src={item.src}
                alt={item.alt}
                width={96}
                height={96}
                className="w-full h-full object-cover"
              />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
