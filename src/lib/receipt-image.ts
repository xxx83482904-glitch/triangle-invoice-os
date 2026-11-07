// Phone photos are 3–8 MB; a 2000px JPEG keeps receipts legible, uploads in a second and fits the 10 MB limit.
const MAX_EDGE = 2000;
const UPLOADABLE = new Set(["application/pdf", "image/jpeg", "image/png"]);

export async function prepareReceiptFile(file: File): Promise<File> {
  if (file.type === "application/pdf") return file;
  try {
    const bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    try {
      const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
      if (scale === 1 && UPLOADABLE.has(file.type) && file.size <= 1.5 * 1024 * 1024) return file;
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale)); canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("canvas unavailable");
      context.fillStyle = "#fff"; context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.85));
      if (!blob) throw new Error("encode failed");
      return new File([blob], `${file.name.replace(/\.[^.]+$/, "") || "receipt"}.jpg`, { type: "image/jpeg", lastModified: file.lastModified });
    } finally { bitmap.close(); }
  } catch {
    if (UPLOADABLE.has(file.type)) return file;
    throw new Error("この画像は読み込めませんでした。JPEG・PNGの写真かPDFを選んでください");
  }
}
