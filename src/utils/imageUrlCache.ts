// A persistent, in-memory cache for Object URLs.
// This survives component unmounts and is shared across the app.
// We use a class to encapsulate the logic for revoking URLs to prevent memory leaks.

class ImageUrlCache {
  // Full-size image cache keyed by numeric picture id
  private cache = new Map<number, string>();
  // Thumbnail cache keyed by string `${id}:thumb:${width}`
  private thumbCache = new Map<string, string>();

  get(key: number): string | undefined {
    return this.cache.get(key);
  }

  set(key: number, value: string): void {
    if (this.cache.has(key)) {
      URL.revokeObjectURL(this.cache.get(key)!);
    }
    this.cache.set(key, value);
  }

  getThumb(key: number, width: number): string | undefined {
    return this.thumbCache.get(`${key}:thumb:${width}`);
  }

  setThumb(key: number, width: number, value: string): void {
    const k = `${key}:thumb:${width}`;
    if (this.thumbCache.has(k)) {
      URL.revokeObjectURL(this.thumbCache.get(k)!);
    }
    this.thumbCache.set(k, value);
  }

  /**
   * Revokes all stored Object URLs and clears both caches.
   */
  revokeAndClear(): void {
    for (const url of this.cache.values()) {
      URL.revokeObjectURL(url);
    }
    for (const url of this.thumbCache.values()) {
      URL.revokeObjectURL(url);
    }
    this.cache.clear();
    this.thumbCache.clear();
  }

  has(key: number): boolean {
    return this.cache.has(key);
  }

  delete(key: number): void {
    if (this.cache.has(key)) this.cache.delete(key);
    // remove thumbnails for this id
    const prefix = `${key}:thumb:`;
    for (const k of Array.from(this.thumbCache.keys())) {
      if (k.startsWith(prefix)) this.thumbCache.delete(k);
    }
  }
}

export const imageUrlCache = new ImageUrlCache();

