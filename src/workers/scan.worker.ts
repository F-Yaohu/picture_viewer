/// <reference lib="webworker" />

import { type Picture, type DataSource } from '../db/db';

// --- Type Definitions ---
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

export interface ScanCommand {
  type: 'scan';
  sources: DataSource[];
  existingPictures: Picture[]; // Main thread provides the current state
}

export interface ProgressReport {
  type: 'progress';
  progress: number; // A value from 0 to 100
  statusText: string;
}

export interface CompletionReport {
  type: 'complete';
  adds: Omit<Picture, 'id'>[];
  updates: Picture[];
  deletes: number[]; // Array of picture IDs to delete
}

export interface ErrorReport { type: 'error'; message: string; }

type PictureData = Omit<Picture, 'id' | 'path'>;

// --- Worker Logic ---

self.onmessage = async (event: MessageEvent<ScanCommand>) => {
  if (event.data.type === 'scan') {
    try {
      const { sources, existingPictures } = event.data;
      
      // Create a fast lookup map from existing data
      const existingMap = new Map<string, Picture>();
      for (const pic of existingPictures) {
        // Use a composite key of sourceId and file name for uniqueness
        existingMap.set(`${pic.sourceId}|${pic.name}`, pic);
      }

      const adds: Omit<Picture, 'id'>[] = [];
      const updates: Picture[] = [];
      const seenKeys = new Set<string>();

      self.postMessage({ type: 'progress', progress: 0, statusText: 'Starting scan...' } as ProgressReport);

      for (const source of sources) {
        if (source.type !== 'local' || !source.id) continue;
        
        const directoryHandle = source.path as unknown as FileSystemDirectoryHandle;
        const fileHandles = await getFileHandles(directoryHandle, source.includeSubfolders ?? false);

        for (const [index, fileHandle] of fileHandles.entries()) {
          const key = `${source.id}|${fileHandle.name}`;
          seenKeys.add(key);
          const existing = existingMap.get(key);
          const file = await fileHandle.getFile();

          if (existing && existing.modified === file.lastModified && existing.size === file.size) {
            // File is unchanged, skip processing. This is the fast path.
          } else {
            // File is new or updated, process it.
            const dimensions = await getImageDimensions(file);
            const pictureData: Omit<Picture, 'id'> = {
              sourceId: source.id,
              name: file.name,
              path: fileHandle as any,
              modified: file.lastModified,
              size: file.size,
              width: dimensions.width,
              height: dimensions.height,
            };
            if (existing) {
              updates.push({ ...pictureData, id: existing.id });
            } else {
              adds.push(pictureData);
            }
          }
          
          if (index % 20 === 0) {
            const progress = (index / fileHandles.length) * 100;
            self.postMessage({ type: 'progress', progress, statusText: `Scanning ${source.name}...` } as ProgressReport);
          }
        }
      }

      // Determine deletions
      const deletes: number[] = [];
      for (const [key, pic] of existingMap.entries()) {
        if (!seenKeys.has(key)) {
          deletes.push(pic.id!);
        }
      }
      
      self.postMessage({ type: 'progress', progress: 100, statusText: 'Finalizing...' } as ProgressReport);
      self.postMessage({ type: 'complete', adds, updates, deletes } as CompletionReport);

    } catch (e: any) {
      self.postMessage({ type: 'error', message: e.message } as ErrorReport);
    }
  }
};

// --- Helper Functions ---

async function getFileHandles(directoryHandle: FileSystemDirectoryHandle, includeSubfolders: boolean): Promise<FileSystemFileHandle[]> {
  const files: FileSystemFileHandle[] = [];
  for await (const entry of directoryHandle.values()) {
    if (entry.kind === 'file' && SUPPORTED_EXTENSIONS.some(ext => entry.name.toLowerCase().endsWith(ext))) {
      files.push(entry as FileSystemFileHandle);
    } else if (entry.kind === 'directory' && includeSubfolders) {
      files.push(...await getFileHandles(entry as FileSystemDirectoryHandle, includeSubfolders));
    }
  }
  return files;
}

async function getImageDimensions(file: File): Promise<{ width: number, height: number }> {
  const bitmap = await createImageBitmap(file);
  const { width, height } = bitmap;
  bitmap.close();
  return { width, height };
}