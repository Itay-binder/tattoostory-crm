declare module "bidi-js" {
  interface Bidi {
    getEmbeddingLevels(text: string, baseDirection?: "ltr" | "rtl" | "auto"): unknown;
    getReorderSegments(text: string, embeddingLevels: unknown, start?: number, end?: number): [number, number][];
  }
  export default function bidiFactory(): Bidi;
}
