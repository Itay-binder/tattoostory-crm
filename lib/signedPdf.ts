import { PDFDocument, rgb } from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { downloadFile } from "@/lib/storage";
import { signerIndexOf, clientDataKeyOf, type ContractField } from "@/lib/contracts";

// פונט עברי (Heebo) — נטען פעם אחת ונשמר במטמון
let fontCache: ArrayBuffer | null = null;
async function hebrewFont(): Promise<ArrayBuffer> {
  if (fontCache) return fontCache;
  const res = await fetch("https://cdn.jsdelivr.net/npm/@expo-google-fonts/heebo/Heebo_400Regular.ttf");
  fontCache = await res.arrayBuffer();
  return fontCache;
}

export function todayDDMMYYYY(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()}`;
}

/** ממיר תאריך ISO ל-DD/MM/YYYY לפי שעון ישראל. */
function isoToDDMMYYYY(iso: string): string {
  try { return new Intl.DateTimeFormat("en-GB", { timeZone: "Asia/Jerusalem" }).format(new Date(iso)); }
  catch { return todayDDMMYYYY(); }
}

interface EnvelopeLike {
  storagePath: string;
  fields: ContractField[];
  senderValues: Record<string, string>;
  clientData: Record<string, string>;
  signers: { index: number; role?: string; signedAt?: string | null; values: Record<string, string>; signaturePaths: Record<string, string> }[];
}

export function resolveValue(f: ContractField, env: EnvelopeLike): string | null {
  if (f.source === "auto:today") {
    // תאריך ההסכם = תאריך החתימה של הלקוח (החותם שאינו "השולח"), לא יום ההפקה
    const client = env.signers.filter((s) => s.role !== "sender" && s.signedAt).sort((a, b) => a.index - b.index)[0]
      || env.signers.filter((s) => s.signedAt).sort((a, b) => a.index - b.index)[0];
    return client?.signedAt ? isoToDDMMYYYY(client.signedAt) : todayDDMMYYYY();
  }
  if (f.source === "sender") return env.senderValues[f.id] || null;
  const key = clientDataKeyOf(f.source);
  if (key) return env.clientData[key] || null;
  const si = signerIndexOf(f.source);
  if (si) return env.signers[si - 1]?.values[f.id] || null;
  return null;
}

export async function generateSignedPdf(env: EnvelopeLike): Promise<Buffer> {
  const tplBytes = await downloadFile(env.storagePath);
  const pdf = await PDFDocument.load(tplBytes);
  pdf.registerFontkit(fontkit);
  const font = await pdf.embedFont(await hebrewFont(), { subset: true });
  const pages = pdf.getPages();

  for (const f of env.fields) {
    const page = pages[f.page];
    if (!page) continue;
    const { width: W, height: H } = page.getSize();
    const boxLeft = f.x * W;
    const boxBottom = H - (f.y + f.h) * H;
    const boxW = f.w * W;
    const boxH = f.h * H;

    if (f.type === "signature") {
      const si = signerIndexOf(f.source);
      const sigPath = si ? env.signers[si - 1]?.signaturePaths?.[f.id] : (f.source === "sender" ? env.signers.find((s) => s.role === "sender")?.signaturePaths?.[f.id] : undefined);
      if (sigPath) {
        try {
          const imgBytes = await downloadFile(sigPath);
          const png = await pdf.embedPng(imgBytes);
          // ממלא את התיבה ברוב השטח (שוליים קטנים), שומר יחס
          const pad = 0.04;
          const availW = boxW * (1 - pad), availH = boxH * (1 - pad);
          const scale = Math.min(availW / png.width, availH / png.height);
          const dw = png.width * scale, dh = png.height * scale;
          page.drawImage(png, { x: boxLeft + (boxW - dw) / 2, y: boxBottom + (boxH - dh) / 2, width: dw, height: dh });
        } catch { /* skip */ }
      }
      continue;
    }

    const raw = resolveValue(f, env);
    if (!raw) continue;
    // pdf-lib + fontkit מציירים עברית לוגית בכיוון הנכון מעצמם — אין צורך בהיפוך
    const text = raw;
    let size = Math.min(boxH * 0.7, 15);
    let tw = font.widthOfTextAtSize(text, size);
    if (tw > boxW) { size = Math.max(6, size * (boxW / tw)); tw = font.widthOfTextAtSize(text, size); }
    const tx = boxLeft + Math.max(0, boxW - tw - 2); // יישור לימין
    const ty = boxBottom + (boxH - size) / 2 + size * 0.2;
    page.drawText(text, { x: tx, y: ty, size, font, color: rgb(0.05, 0.05, 0.12) });
  }

  const out = await pdf.save();
  return Buffer.from(out);
}
