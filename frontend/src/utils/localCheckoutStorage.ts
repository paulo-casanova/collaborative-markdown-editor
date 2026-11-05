/**
 * Utility for managing local checkouts using the File System Access API
 * (window.showDirectoryPicker) with persistent IndexedDB directory handle,
 * falling back to standard browser downloads.
 */

const DB_NAME = 'cme_checkout_storage';
const DB_VERSION = 1;
const STORE_NAME = 'handles';
const KEY_DIR_HANDLE = 'checkout_directory_handle';

function openCheckoutDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      return reject(new Error('IndexedDB not supported in this environment'));
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

/**
 * Checks if File System Access API is supported.
 */
export function isFileSystemAccessSupported(): boolean {
  return typeof window !== 'undefined' && 'showDirectoryPicker' in window;
}

/**
 * Retrieves the stored FileSystemDirectoryHandle from IndexedDB.
 */
export async function getStoredDirectoryHandle(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    const db = await openCheckoutDB();
    return new Promise((resolve) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const req = store.get(KEY_DIR_HANDLE);
      req.onsuccess = () => resolve(req.result || null);
      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

/**
 * Stores a FileSystemDirectoryHandle in IndexedDB.
 */
export async function storeDirectoryHandle(handle: FileSystemDirectoryHandle): Promise<void> {
  if (!isFileSystemAccessSupported()) return;
  try {
    const db = await openCheckoutDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.put(handle, KEY_DIR_HANDLE);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch (e) {
    console.warn('Failed to store directory handle in IndexedDB:', e);
  }
}

/**
 * Clears the stored directory handle.
 */
export async function clearStoredDirectoryHandle(): Promise<void> {
  try {
    const db = await openCheckoutDB();
    return new Promise((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const req = store.delete(KEY_DIR_HANDLE);
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error);
    });
  } catch {}
}

/**
 * Prompts user to pick a local checkout folder and stores it.
 */
export async function promptChooseDirectory(): Promise<FileSystemDirectoryHandle | null> {
  if (!isFileSystemAccessSupported()) {
    throw new Error('File System Access API is not supported in this browser.');
  }

  // @ts-expect-error window.showDirectoryPicker
  const handle: FileSystemDirectoryHandle = await window.showDirectoryPicker({
    mode: 'readwrite',
  });
  await storeDirectoryHandle(handle);
  return handle;
}

/**
 * Verifies or requests permission for a directory handle.
 */
export async function verifyPermission(
  handle: FileSystemDirectoryHandle,
  readWrite: boolean = true
): Promise<boolean> {
  const options: Record<string, string> = {};
  if (readWrite) {
    options.mode = 'readwrite';
  }
  // @ts-expect-error queryPermission
  if ((await handle.queryPermission(options)) === 'granted') {
    return true;
  }
  // @ts-expect-error requestPermission
  if ((await handle.requestPermission(options)) === 'granted') {
    return true;
  }
  return false;
}

/**
 * Triggers standard browser download for a blob or file.
 */
export function triggerBrowserDownload(blob: Blob, filename: string): void {
  if (typeof document === 'undefined') return;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Saves checked-out file data locally.
 * If a directory handle is stored or available, saves directly to disk.
 * Otherwise, falls back to browser download.
 *
 * @returns object indicating whether saved via directory handle or browser download, and the destination info.
 */
export async function saveCheckedOutFile(
  filename: string,
  data: Blob
): Promise<{ method: 'directory' | 'download'; folderName?: string }> {
  if (isFileSystemAccessSupported()) {
    try {
      let dirHandle = await getStoredDirectoryHandle();
      if (!dirHandle) {
        // Prompt user to pick a checkout directory
        dirHandle = await promptChooseDirectory();
      }

      if (dirHandle && (await verifyPermission(dirHandle, true))) {
        const fileHandle = await dirHandle.getFileHandle(filename, { create: true });
        const writable = await fileHandle.createWritable();
        await writable.write(data);
        await writable.close();
        return { method: 'directory', folderName: dirHandle.name };
      }
    } catch (e: unknown) {
      // User cancelled picker or permission denied - fallback to browser download
      if ((e as Error)?.name !== 'AbortError') {
        console.warn('File System Access write failed, falling back to download:', e);
      }
    }
  }

  // Fallback
  triggerBrowserDownload(data, filename);
  return { method: 'download' };
}

/**
 * Attempts to read a file from the stored directory handle if available.
 */
export async function readFileFromStoredDirectory(filename: string): Promise<File | null> {
  if (!isFileSystemAccessSupported()) return null;
  try {
    const dirHandle = await getStoredDirectoryHandle();
    if (!dirHandle) return null;
    if (!(await verifyPermission(dirHandle, false))) return null;
    const fileHandle = await dirHandle.getFileHandle(filename, { create: false });
    return await fileHandle.getFile();
  } catch {
    return null;
  }
}
