import {
  type Artwork,
  type Recipe,
  type Session,
  SESSION_KEY,
  parseRecipe,
  parseSession,
  newRecipe,
} from "./cooking-model";
import { dishSVG } from "./cooking-art";
import { embedIllustrations } from "./illustration-assets";
import { readSavedState } from "./model";
const DB_NAME = "akira-kitchen-album";
type StoredArtwork=Omit<Artwork,"image"> & {image:Blob|ArrayBuffer;imageType?:string};
export function openAlbum(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") {
      reject(new Error("このブラウザでは アルバムを ひらけません"));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () =>
      request.result.createObjectStore("works", { keyPath: "id" });
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("ほかの タブを とじて もういちど"));
  });
}
async function transaction<T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const db = await openAlbum();
  return new Promise((resolve, reject) => {
    const tx = db.transaction("works", mode),
      req = operation(tx.objectStore("works"));
    let result: T;
    req.onsuccess = () => {
      result = req.result;
    };
    tx.oncomplete = () => {
      db.close();
      resolve(result);
    };
    tx.onabort = tx.onerror = () => {
      db.close();
      reject(
        tx.error ?? req.error ?? new Error("ほぞんを もういちど ためしてね"),
      );
    };
  });
}
export async function listArtworks(): Promise<Artwork[]> {
  const all = await transaction("readonly", (s) => s.getAll());
  return all
    .flatMap((v: StoredArtwork) => {
      const recipe = parseRecipe(v.recipe);
      const image=v.image instanceof Blob?v.image:v.image instanceof ArrayBuffer?new Blob([v.image],{type:v.imageType??"image/svg+xml"}):null;
      return recipe &&
        image &&
        typeof v.createdAt === "string" &&
        !Number.isNaN(Date.parse(v.createdAt))
        ? [{ ...v, recipe, image }]
        : [];
    })
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}
export async function saveArtwork(recipe: Recipe): Promise<Artwork> {
  const work: Artwork = {
    id: recipe.id,
    createdAt: new Date().toISOString(),
    recipe: structuredClone(recipe),
    image: new Blob([await embedIllustrations(dishSVG(recipe))], {
      type: "image/svg+xml",
    }),
  };
  await putArtwork(work);
  return work;
}
export async function putArtwork(work: Artwork) {
  try { await transaction("readwrite", (s) => s.put(work)); }
  catch(error){
    // Some WebKit ports cannot persist Blob/File payloads. Keep the same DB,
    // store, id and recipe; raw bytes are normalized back to Blob when read.
    if(!error||typeof error!=="object"||!("name" in error)||!["UnknownError","DataCloneError"].includes(String(error.name)))throw error;
    const stored:StoredArtwork={...work,image:await work.image.arrayBuffer(),imageType:work.image.type};
    await transaction("readwrite",s=>s.put(stored));
  }
}
export async function deleteArtwork(id: string) {
  await transaction("readwrite", (s) => s.delete(id));
}
export function readSession(): Session | null {
  try {
    return parseSession(localStorage.getItem(SESSION_KEY));
  } catch {
    return null;
  }
}
export function saveSession(session: Session): boolean {
  try {
    localStorage.setItem(SESSION_KEY, JSON.stringify(session));
    return true;
  } catch {
    return false;
  }
}
export async function migrateLegacy(): Promise<void> {
  let raw: string | null;
  try {
    raw = localStorage.getItem("akira-kitchen:v1");
    if (!raw || localStorage.getItem("akira-kitchen:migrated:v2")) return;
  } catch {
    return;
  }
  const existing = new Set((await listArtworks()).map((w) => w.id));
  const map: Record<string, string> = {
    rice: "onigiri",
    egg: "tamago",
    shrimp: "karaage",
    sausage: "karaage",
    peas: "broccoli",
    kiwi: "banana",
    orange: "banana",
    star: "sprinkles",
    heart: "sprinkles",
  };
  for (const old of readSavedState(raw).works) {
    if (existing.has(old.id)) continue;
    const r = newRecipe(old.mode);
    r.id = old.id;
    r.cake =
      old.base === "berry"
        ? "strawberry"
        : old.base === "chocolate"
          ? "chocolate"
          : "vanilla";
    r.items = old.items.map(
      (p) =>
        ({
          ...p,
          food: map[p.food] ?? p.food,
          variant: "nori",
          x: p.x,
          y: p.y,
        }) as Recipe["items"][number],
    );
    const parsed = parseRecipe(r);
    if (parsed)
      await putArtwork({
        id: old.id,
        createdAt: old.createdAt,
        recipe: parsed,
        image: new Blob([await embedIllustrations(dishSVG(parsed))], {
          type: "image/svg+xml",
        }),
      });
  }
  try {
    localStorage.setItem("akira-kitchen:migrated:v2", "yes");
  } catch {
    /* Idempotent by artwork id even if marker cannot be stored. */
  }
}
