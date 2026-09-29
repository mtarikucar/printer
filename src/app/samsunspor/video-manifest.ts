// BU DOSYA ELLE DÜZENLENMEZ.
// Üreten: node scripts/samsunspor-video.mjs "kaynak.mp4"

export type VideoRendition = {
  /** Piksel boyutu. */
  width: number;
  height: number;
  /** public/ altındaki yol; adındaki özet içerikle birlikte değişir. */
  src: string;
  /** Dosya boyutu (bayt). */
  bytes: number;
};

export const SAMSUNSPOR_VIDEO = {
  /** Genişlik / yükseklik. */
  aspect: 3840 / 2160,
  durationSeconds: 10.08,
  hasAudio: true,
  poster: "/samsunspor/poster.919f483b.webp",
  /** Küçükten büyüğe sıralı. */
  renditions: [
      {
          "width": 854,
          "height": 480,
          "src": "/samsunspor/kalkan-480.729eb337.mp4",
          "bytes": 2669150
      },
      {
          "width": 1280,
          "height": 720,
          "src": "/samsunspor/kalkan-720.1adc527f.mp4",
          "bytes": 5021594
      },
      {
          "width": 1920,
          "height": 1080,
          "src": "/samsunspor/kalkan-1080.db85e91b.mp4",
          "bytes": 11134472
      },
      {
          "width": 3840,
          "height": 2160,
          "src": "/samsunspor/kalkan-2160.2120db7c.mp4",
          "bytes": 36321841
      }
  ] satisfies VideoRendition[],
};
