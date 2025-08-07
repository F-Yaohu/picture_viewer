// A persistent, in-memory cache for Object URLs.
// This survives component unmounts and is shared across the app.
// We use a class to encapsulate the logic for revoking URLs to prevent memory leaks.

class ImageUrlCache {
  private cache = new Map<number, string>();

  get(key: number): string | undefined {
    return this.cache.get(key);
  }

  set(key: number, value: string): void {
    // If an old URL exists for this key, revoke it before setting the new one.
    if (this.cache.has(key)) {
      URL.revokeObjectURL(this.cache.get(key)!);
    }
    this.cache.set(key, value);
  }

  /**
   * Revokes all stored Object URLs and clears the cache.
   * This is crucial to call when handles might have become invalid.
   */
  revokeAndClear(): void {
    for (const url of this.cache.values()) {
      URL.revokeObjectURL(url);
    }
    this.cache.clear();
  }
}

export const imageUrlCache = new ImageUrlCache();

