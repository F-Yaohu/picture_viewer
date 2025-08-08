/// <reference lib="webworker" />

import { type Picture, type DataSource } from '../db/db';

// --- Type Definitions ---
const SUPPORTED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];

export interface ScanCommand {
  type: 'scan';
  sources: DataSource[];
  existingPictures: Picture[];
  sourceIdsToScan: number[]; // Explicitly tell the worker which sources are in scope for deletion
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

// --- Worker Logic ---

async function scanLocalSource(source: DataSource, existingMap: Map<string, Picture>): Promise<{ adds: Omit<Picture, 'id'>[], updates: Picture[], seenKeys: Set<string> }> {
  const adds: Omit<Picture, 'id'>[] = [];
  const updates: Picture[] = [];
  const seenKeys = new Set<string>();

  const directoryHandle = source.path as unknown as FileSystemDirectoryHandle;
  const fileHandles = await getFileHandles(directoryHandle, source.includeSubfolders ?? false);

  for (const [index, fileHandle] of fileHandles.entries()) {
    const key = `${source.id}|${fileHandle.name}`;
    seenKeys.add(key);
    const existing = existingMap.get(key);
    const file = await fileHandle.getFile();

    if (existing && existing.modified === file.lastModified && existing.size === file.size) {
      // File is unchanged, skip processing.
    } else {
      // File is new or updated, process it.
      const dimensions = await getImageDimensions(file);
      const pictureData: Omit<Picture, 'id'> = {
        sourceId: source.id!,
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
  return { adds, updates, seenKeys };
}

self.onmessage = async (event: MessageEvent<ScanCommand>) => {
  if (event.data.type === 'scan') {
    try {
      const { sources, existingPictures, sourceIdsToScan } = event.data;
      
      const existingMap = new Map<string, Picture>();
      const existingBySource = new Map<number, Map<string, Picture>>();

      for (const pic of existingPictures) {
        if (!pic.sourceId) continue;
        const key = typeof pic.path === 'string' ? `${pic.sourceId}|${pic.path}` : `${pic.sourceId}|${pic.name}`;
        existingMap.set(key, pic);

        if (!existingBySource.has(pic.sourceId)) {
          existingBySource.set(pic.sourceId, new Map());
        }
        existingBySource.get(pic.sourceId)!.set(key, pic);
      }

      const allAdds: Omit<Picture, 'id'>[] = [];
      const allUpdates: Picture[] = [];
      const allDeletes: number[] = [];

      self.postMessage({ type: 'progress', progress: 0, statusText: 'Starting scan...' } as ProgressReport);

      for (const source of sources) {
        if (!source.id) continue;

        let results;
        if (source.type === 'local') {
          results = await scanLocalSource(source, existingMap);
        } else if (source.type === 'remote') {
          results = await scanRemoteSource(source, existingMap);
        }

        if (results) {
          allAdds.push(...results.adds);
          allUpdates.push(...results.updates);
          
          // --- ISOLATED DELETION LOGIC ---
          const sourceId = source.id;
          if (sourceIdsToScan.includes(sourceId)) {
            const seenKeysForSource = results.seenKeys;
            const existingForSource = existingBySource.get(sourceId) || new Map();
            for (const [key, pic] of existingForSource.entries()) {
              if (!seenKeysForSource.has(key)) {
                allDeletes.push(pic.id!);
              }
            }
          }
        }
      }
      
      self.postMessage({ type: 'progress', progress: 100, statusText: 'Finalizing...' } as ProgressReport);
      self.postMessage({ type: 'complete', adds: allAdds, updates: allUpdates, deletes: allDeletes } as CompletionReport);

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
  try {
    const bitmap = await createImageBitmap(file);
    const { width, height } = bitmap;
    bitmap.close(); // Release memory
    return { width, height };
  } catch (error) {
    // Could be a non-image file that passed the extension check
    console.warn(`Could not get dimensions for file: ${file.name}`, error);
    return { width: 0, height: 0 }; // Return default dimensions
  }
}

function getValueByPath(obj: any, path: string): any {
  return path.split('.').reduce((acc, part) => acc && acc[part], obj);
}

function resolveExpression(template: string, page: number): string {
  return template.replace(/{{(.*?)}}/g, (_, expression) => {
    try {
      // Create a function to safely evaluate the expression with 'page' in its scope
      return new Function('page', `return ${expression}`)(page);
    } catch (e) {
      console.error(`Error evaluating expression: ${expression}`, e);
      return ''; // Return empty string if expression is invalid
    }
  });
}

async function scanRemoteSource(source: DataSource, existingMap: Map<string, Picture>): Promise<{ adds: Omit<Picture, 'id'>[], updates: Picture[], seenKeys: Set<string> }> {
  if (!source.remoteConfig) return { adds: [], updates: [], seenKeys: new Set() };

  const { url, method, headers, body, responsePath, fieldMapping, maxImages, baseURL } = source.remoteConfig;
  const adds: Omit<Picture, 'id'>[] = [];
  const updates: Picture[] = [];
  const seenKeys = new Set<string>();
  let page = 1;
  let hasMore = true;

  while (hasMore) {
    if (maxImages && adds.length >= maxImages) {
      hasMore = false;
      continue;
    }

    self.postMessage({ type: 'progress', progress: (page % 10) * 10, statusText: `Fetching page ${page} from ${source.name}...` } as ProgressReport);

    const finalUrl = new URL(resolveExpression(url, page));
    const params = new URLSearchParams();
    
    const bodyData = body ? JSON.parse(resolveExpression(body, page)) : {};

    if (method === 'GET') {
      for (const key in bodyData) {
        params.append(key, bodyData[key]);
      }
      finalUrl.search = params.toString();
    }
    
    const requestOptions: RequestInit = {
      method,
      headers: new Headers(headers),
      body: method === 'POST' ? JSON.stringify(bodyData) : undefined,
    };

    try {
      const response = await fetch(finalUrl.toString(), requestOptions);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      const images = getValueByPath(data, responsePath);

      if (!Array.isArray(images) || images.length === 0) {
        hasMore = false;
        continue;
      }

      for (const image of images) {
        let imageUrl = getValueByPath(image, fieldMapping.url);
        const imageName = getValueByPath(image, fieldMapping.name);
        const modifiedStr = fieldMapping.modified ? getValueByPath(image, fieldMapping.modified) : undefined;
        const modified = modifiedStr ? new Date(modifiedStr).getTime() : Date.now();

        if (!imageUrl || !imageName) continue;

        // Prepend baseURL if it exists and the imageUrl is a relative path
        if (baseURL && !imageUrl.startsWith('http')) {
          imageUrl = new URL(imageUrl, baseURL).href;
        }

        const key = `${source.id}|${imageUrl}`; // Use URL as the unique identifier for remote images
        seenKeys.add(key);
        const existing = existingMap.get(key);

        if (existing && existing.modified === modified) {
          // Unchanged
        } else {
          const pictureData: Omit<Picture, 'id'> = {
            sourceId: source.id!,
            name: imageName,
            path: imageUrl,
            modified,
            // We don't know the size/dimensions of remote images yet
          };
          if (existing) {
            updates.push({ ...pictureData, id: existing.id });
          } else {
            adds.push(pictureData);
          }
        }
      }
      page++;
    } catch (error: any) {
      self.postMessage({ type: 'error', message: `Failed to fetch from ${source.name}: ${error.message}` } as ErrorReport);
      hasMore = false; // Stop pagination on error
    }
  }
  return { adds, updates, seenKeys };
}
