"use client";

// טעינה עצלה של pdfjs — רק בדפדפן, כדי לא לגעת ב-DOMMatrix בזמן SSR/prerender.
type PdfjsModule = typeof import("pdfjs-dist");
let pdfjsPromise: Promise<PdfjsModule> | null = null;

// כל נכסי המנוע (worker, cmaps, standard_fonts) מוגשים מהדומיין שלנו (public/pdfjs)
// ולא מ-CDN חיצוני — כדי שהתצוגה לא תיפול ללבן כשה-CDN חסום/איטי אצל הלקוח.
const PDFJS_ASSETS = "/pdfjs";

async function getPdfjs(): Promise<PdfjsModule> {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((lib) => {
      lib.GlobalWorkerOptions.workerSrc = `${PDFJS_ASSETS}/pdf.worker.min.mjs`;
      return lib;
    });
  }
  return pdfjsPromise;
}

export async function loadPdf(src: string | ArrayBuffer) {
  const lib = await getPdfjs();
  const base = typeof src === "string" ? { url: src } : { data: src };
  // cMapUrl + standardFontDataUrl נדרשים לרינדור תקין של עברית/פונטים לא-לטיניים.
  // disableFontFace: מצייר את הפונט המוטבע כוקטור (paths) במקום דרך @font-face —
  // מונע את הצפיפות/חפיפה של אותיות עבריות בדפדפן ונותן רינדור מדויק כמו במציג PDF רגיל.
  return lib.getDocument({
    ...base,
    cMapUrl: `${PDFJS_ASSETS}/cmaps/`,
    cMapPacked: true,
    standardFontDataUrl: `${PDFJS_ASSETS}/standard_fonts/`,
    disableFontFace: true,
  }).promise;
}
