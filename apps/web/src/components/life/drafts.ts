import type { EnvironmentId } from "@t3tools/contracts";

export interface CaptureDraft {
  requestId: string;
  title: string;
  text: string;
  files: File[];
}
const open = () =>
  new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("j3-life-capture-drafts", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("drafts");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(new Error("Could not open capture draft storage."));
  });

export async function loadDraft(environmentId: EnvironmentId): Promise<CaptureDraft | null> {
  const db = await open();
  try {
    return await new Promise((resolve, reject) => {
      const request = db.transaction("drafts").objectStore("drafts").get(environmentId);
      request.onsuccess = () => resolve((request.result as CaptureDraft | undefined) ?? null);
      request.onerror = () => reject(new Error("Could not restore the capture draft."));
    });
  } finally {
    db.close();
  }
}

export async function saveDraft(environmentId: EnvironmentId, draft: CaptureDraft | null) {
  const db = await open();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction("drafts", "readwrite");
      if (draft === null) transaction.objectStore("drafts").delete(environmentId);
      else transaction.objectStore("drafts").put(draft, environmentId);
      transaction.oncomplete = () => resolve();
      transaction.onerror = () =>
        reject(
          new Error(
            "The draft could not be saved on this device. Keep this page open until it uploads.",
          ),
        );
      transaction.onabort = () =>
        reject(
          new Error(
            "The draft could not be saved on this device. Keep this page open until it uploads.",
          ),
        );
    });
  } finally {
    db.close();
  }
}

export async function encodeCaptureFile(file: File) {
  if (file.size > 8 * 1024 * 1024)
    throw new Error("Each capture must be 8 MB or smaller in total.");
  return await new Promise<{ name: string; mime: string; base64: string }>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () =>
      resolve({
        name: file.name,
        mime: file.type || "application/octet-stream",
        base64: String(reader.result).split(",")[1] ?? "",
      });
    reader.onerror = () => reject(new Error("This file could not be read. Choose it again."));
    reader.readAsDataURL(file);
  });
}
