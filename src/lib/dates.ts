// Calendar dates in Japan, independent of the browser/server's local time zone.
export function todayInJapan(now = new Date()) {
  return new Intl.DateTimeFormat("sv-SE", { timeZone: "Asia/Tokyo" }).format(now);
}
