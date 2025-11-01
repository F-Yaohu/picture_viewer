/// <reference lib="webworker" />

import { type Picture, type DataSource } from '../db/db';
import * as exifr from 'exifr';

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
  const disabledFolders = new Set(source.disabledFolders ?? []);
  const fileEntries = await getFileEntries(directoryHandle, source.includeSubfolders ?? false, disabledFolders);

  for (const [index, entry] of fileEntries.entries()) {
    const { handle: fileHandle, relativePath } = entry;
    const relativeKeyPart = relativePath ? `${relativePath}/${fileHandle.name}` : fileHandle.name;
    const key = `${source.id}|${relativeKeyPart}`;
    seenKeys.add(key);
    const existing = existingMap.get(key);
    const file = await fileHandle.getFile();

    if (existing && existing.modified === file.lastModified && existing.size === file.size) {
      // File is unchanged, skip processing.
    } else {
      // File is new or updated, process it.
      const dimensions = await getImageDimensions(file);
      // parse EXIF (best-effort) for local files to store useful metadata
      let exif: any = null;
      try {
        const buffer = await file.arrayBuffer();
        // Parse only common EXIF tags to keep parsing fast and lightweight
        exif = await exifr.parse(buffer, [
          'Make', 'Model', 'DateTimeOriginal', 'CreateDate',
          'ISO', 'ISOSpeedRatings', 'FNumber', 'ApertureValue', 'ExposureTime',
          'GPSLatitude', 'GPSLongitude', 'GPSLatitudeRef', 'GPSLongitudeRef'
        ]).catch(() => null);
      } catch (e) {
        exif = null;
      }

      const pictureData: Omit<Picture, 'id'> = {
        sourceId: source.id!,
        name: file.name,
        path: fileHandle as any,
        modified: file.lastModified,
        size: file.size,
        width: dimensions.width,
        height: dimensions.height,
        relativePath: relativeKeyPart,
        // map common EXIF fields if present
        exifMake: exif?.Make || exif?.make || undefined,
        exifModel: exif?.Model || exif?.model || undefined,
        exifCreateDate: exif?.DateTimeOriginal ? (new Date(exif.DateTimeOriginal).getTime()) : (exif?.CreateDate ? (new Date(exif.CreateDate).getTime()) : undefined),
        exifISO: exif?.ISO || exif?.ISOSpeedRatings || undefined,
        exifFNumber: exif?.FNumber || exif?.ApertureValue || undefined,
        exifExposureTime: exif?.ExposureTime || undefined,
        exifGPSLat: exif?.latitude || (Array.isArray(exif?.GPSLatitude) ? (() => { const [d,m,s]=exif.GPSLatitude; return d + m/60 + s/3600; })() : undefined) ,
        exifGPSLon: exif?.longitude || (Array.isArray(exif?.GPSLongitude) ? (() => { const [d,m,s]=exif.GPSLongitude; return d + m/60 + s/3600; })() : undefined),
        exifRaw: exif || undefined,
      };
      if (existing) {
        updates.push({ ...pictureData, id: existing.id });
      } else {
        adds.push(pictureData);
      }
    }

    if (index % 20 === 0) {
      const progress = (index / fileEntries.length) * 100;
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
        const relativeKeyPart = pic.relativePath
          ? pic.relativePath
          : (typeof pic.path === 'string' ? pic.path : pic.name);
        const key = `${pic.sourceId}|${relativeKeyPart}`;
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

interface FileEntryWithPath {
  handle: FileSystemFileHandle;
  relativePath: string;
}

async function getFileEntries(directoryHandle: FileSystemDirectoryHandle, includeSubfolders: boolean, disabledFolders: Set<string>, currentPath = ''): Promise<FileEntryWithPath[]> {
  const files: FileEntryWithPath[] = [];
  for await (const entry of directoryHandle.values()) {
    if (entry.kind === 'file' && SUPPORTED_EXTENSIONS.some(ext => entry.name.toLowerCase().endsWith(ext))) {
      files.push({ handle: entry as FileSystemFileHandle, relativePath: currentPath });
    } else if (entry.kind === 'directory' && includeSubfolders) {
      const nextPath = currentPath ? `${currentPath}/${entry.name}` : entry.name;
      const isExcluded = isFolderExcluded(nextPath, disabledFolders);
      if (!isExcluded) {
        files.push(...await getFileEntries(entry as FileSystemDirectoryHandle, includeSubfolders, disabledFolders, nextPath));
      }
    }
  }
  return files;
}

function isFolderExcluded(path: string, disabledFolders: Set<string>): boolean {
  if (disabledFolders.size === 0) return false;
  for (const disabled of disabledFolders) {
    if (path === disabled || path.startsWith(`${disabled}/`)) {
      return true;
    }
  }
  return false;
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

    // 通过代理请求远程API
    const proxyUrl = '/api/proxy';
    const proxyRequestBody = {
      url: finalUrl.toString(),
      method,
      headers,
      body: method === 'POST' ? JSON.stringify(bodyData) : undefined,
    };

    try {
      const response = await fetch(proxyUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(proxyRequestBody),
      });
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
        if (maxImages && seenKeys.size >= maxImages) {
          hasMore = false;
          break;
        }

        let imageUrl = getValueByPath(image, fieldMapping.url);
        const imageName = getValueByPath(image, fieldMapping.name);
        const modifiedStr = fieldMapping.modified ? getValueByPath(image, fieldMapping.modified) : undefined;
        const modified = modifiedStr ? new Date(modifiedStr).getTime() : Date.now();

        if (!imageUrl || !imageName) continue;

        if (baseURL && !imageUrl.startsWith('http')) {
          imageUrl = new URL(imageUrl, baseURL).href;
        }

        const key = `${source.id}|${imageUrl}`;
        if (seenKeys.has(key)) continue; // 避免重复

        seenKeys.add(key);
        const existing = existingMap.get(key);

        if (existing && existing.modified === modified) {
          // Unchanged
        } else if (existing) {
          updates.push({ ...existing, name: imageName, path: imageUrl, modified });
        } else {
          adds.push({
            sourceId: source.id!,
            name: imageName,
            path: imageUrl,
            modified,
          });
        }
      }
      page++;
    } catch (error: any) {
      self.postMessage({ type: 'error', message: `Failed to fetch from ${source.name}: ${error.message}` } as ErrorReport);
      hasMore = false;
    }
  }
  return { adds, updates, seenKeys };
}
