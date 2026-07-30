/**
 * 배경 참조 이미지 저장소.
 *
 * 이미지 dataURL은 수 MB에 이르므로 문서(ProjectDoc) 안에 두면
 * 히스토리 스냅샷마다 복제되어 메모리를 폭발시키고 자동저장 한도도 넘긴다.
 * 따라서 문서에는 짧은 키만 남기고 실제 데이터는 이 모듈이 보관한다.
 *
 * - 메모리: 키 -> dataURL 맵 (렌더링에 즉시 사용)
 * - 영속화: IndexedDB (localStorage의 약 5MB 한도를 받지 않음, 최선 노력)
 * - 프로젝트 파일 저장/불러오기 시에만 dataURL로 펼쳐 이식성을 유지한다.
 */

const DB_NAME = "overlayplacer";
const DB_VERSION = 1;
const STORE_NAME = "images";

const memory = new Map<string, string>();
let counter = 0;

export function isImageKey(value: string): boolean {
  return value.startsWith("img_");
}

function newKey(): string {
  counter = (counter + 1) % 1679616;
  const rand = Math.floor(Math.random() * 1679616).toString(36).padStart(4, "0");
  return `img_${rand}${counter.toString(36).padStart(4, "0")}`;
}

/** dataURL을 등록하고 문서에 저장할 키를 돌려준다. */
export function registerImage(dataUrl: string): string {
  const key = newKey();
  memory.set(key, dataUrl);
  void persist(key, dataUrl);
  return key;
}

/** 이미 정해진 키로 등록 (프로젝트 파일 불러오기 등) */
export function registerImageWithKey(key: string, dataUrl: string): void {
  memory.set(key, dataUrl);
  void persist(key, dataUrl);
}

export function getImage(key: string | null): string | null {
  if (!key) return null;
  return memory.get(key) ?? null;
}

export function hasImage(key: string | null): boolean {
  return !!key && memory.has(key);
}

export function forgetImage(key: string | null): void {
  if (!key) return;
  memory.delete(key);
  void remove(key);
}

/** 문서가 더 이상 참조하지 않는 이미지를 정리한다. */
export function pruneImages(usedKeys: Set<string>): void {
  for (const key of [...memory.keys()]) {
    if (!usedKeys.has(key)) {
      memory.delete(key);
      void remove(key);
    }
  }
}

/* ---------- IndexedDB (최선 노력) ---------- */

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    if (typeof indexedDB === "undefined") {
      resolve(null);
      return;
    }
    let req: IDBOpenDBRequest;
    try {
      req = indexedDB.open(DB_NAME, DB_VERSION);
    } catch {
      resolve(null);
      return;
    }
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE_NAME)) {
        req.result.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => resolve(null);
    req.onblocked = () => resolve(null);
  });
}

let dbPromise: Promise<IDBDatabase | null> | null = null;

function db(): Promise<IDBDatabase | null> {
  if (!dbPromise) dbPromise = openDb();
  return dbPromise;
}

async function persist(key: string, dataUrl: string): Promise<void> {
  const conn = await db();
  if (!conn) return;
  try {
    const tx = conn.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).put(dataUrl, key);
  } catch { /* 저장 실패는 무시 — 메모리에는 남아 있다 */ }
}

async function remove(key: string): Promise<void> {
  const conn = await db();
  if (!conn) return;
  try {
    const tx = conn.transaction(STORE_NAME, "readwrite");
    tx.objectStore(STORE_NAME).delete(key);
  } catch { /* 무시 */ }
}

/** 시작 시 저장된 이미지를 메모리로 복원한다. */
export async function hydrateImages(): Promise<number> {
  const conn = await db();
  if (!conn) return 0;
  return new Promise((resolve) => {
    try {
      const tx = conn.transaction(STORE_NAME, "readonly");
      const store = tx.objectStore(STORE_NAME);
      const keysReq = store.getAllKeys();
      const valsReq = store.getAll();
      tx.oncomplete = () => {
        const keys = keysReq.result as IDBValidKey[];
        const vals = valsReq.result as string[];
        for (let i = 0; i < keys.length; i++) {
          if (typeof keys[i] === "string" && typeof vals[i] === "string") {
            memory.set(keys[i] as string, vals[i]);
          }
        }
        resolve(keys.length);
      };
      tx.onerror = () => resolve(0);
      tx.onabort = () => resolve(0);
    } catch {
      resolve(0);
    }
  });
}
