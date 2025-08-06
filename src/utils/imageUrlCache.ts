// A persistent, in-memory cache for Object URLs.
// This survives component unmounts and is shared across the app.
export const imageUrlCache = new Map<number, string>();
