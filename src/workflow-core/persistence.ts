export type StorageLike = Pick<Storage, "getItem" | "setItem" | "removeItem">;
export type StorageWriteResult = { ok: true } | { ok: false; reason: "quota" | "unavailable" | "protected"; message: string };

function storageError(error: unknown): StorageWriteResult {
  const name = error instanceof DOMException ? error.name : error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error ?? "本地存储不可用");
  const quota = name === "QuotaExceededError" || /quota/i.test(message);
  return { ok: false, reason: quota ? "quota" : "unavailable", message };
}

export function writeStorage(storage: StorageLike, key: string, value: string): StorageWriteResult {
  try {
    storage.setItem(key, value);
    return { ok: true };
  } catch (error) {
    return storageError(error);
  }
}

export function readStorage(storage: StorageLike, key: string): string | null {
  try { return storage.getItem(key); } catch { return null; }
}

export function removeStorage(storage: StorageLike, key: string): boolean {
  try { storage.removeItem(key); return true; } catch { return false; }
}
