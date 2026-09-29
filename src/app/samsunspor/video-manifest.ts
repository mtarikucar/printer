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
  aspect: 1920 / 1080,
  durationSeconds: 10.08,
  hasAudio: true,
  poster: "/samsunspor/poster.5c783734.webp",
  /** Küçükten büyüğe sıralı. */
  renditions: [
      {
          "width": 854,
          "height": 480,
          "src": "/samsunspor/kalkan-480.f1e45dce.mp4",
          "bytes": 2334211
      },
      {
          "width": 1280,
          "height": 720,
          "src": "/samsunspor/kalkan-720.955940a9.mp4",
          "bytes": 4262663
      },
      {
          "width": 1920,
          "height": 1080,
          "src": "/samsunspor/kalkan-1080.7d253c31.mp4",
          "bytes": 9591870
      }
  ] satisfies VideoRendition[],
};
