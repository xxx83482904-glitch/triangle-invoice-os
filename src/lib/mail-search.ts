type SearchableMail = { senderName?: string; fileName: string; ocrPreview: string; extracted?: { vendorName: string; projectName: string } };

export function matchesMailSearch(row: SearchableMail, query: string) {
  const terms = query.normalize("NFKC").toLocaleLowerCase().trim().split(/\s+/).filter(Boolean);
  const text = [row.senderName, row.fileName, row.ocrPreview, row.extracted?.vendorName, row.extracted?.projectName].filter(Boolean).join(" ").normalize("NFKC").toLocaleLowerCase();
  return terms.every((term) => text.includes(term));
}
