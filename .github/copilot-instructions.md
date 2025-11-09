# AI Agent Instructions for Picture Viewer App

## Architecture Overview

**Picture Viewer** is a React + TypeScript + Vite image management app with IndexedDB persistence, Web Workers for scanning, and a Node.js backend for serving/proxying images. Core design goal: **handle 10,000+ images smoothly via paginated, time-sorted loading**.

### Tech Stack
- **Frontend**: React 19 + TypeScript, MUI, Redux Toolkit, Dexie (IndexedDB), i18next
- **Backend**: Node.js/Express (`server.cjs`) with `sharp` for thumbnails, `chokidar` for file watching
- **Build**: Vite 7 with Web Worker support, Docker deployment via nginx proxy

### Critical Files
- `src/App.tsx` - Main app, scan worker orchestration, global state
- `src/components/ImageGrid.tsx` - **Core pagination logic** (dual-mode: client offset for local/remote, server offset per source)
- `src/workers/scan.worker.ts` - Scans local folders, parses EXIF via `exifr`, computes diffs (adds/updates/deletes)
- `src/db/db.ts` - Dexie schema (12 versions), `DataSource` and `Picture` tables
- `server.cjs` - REST API for server sources, 3-tier thumbnail cache (400/800/1600px WebP)

---

## Core Design Patterns

### 1. Multi-Source Pagination Strategy
**Problem**: Different source types (local/remote/server) require different loading patterns.

**Solution** (see `ImageGrid.tsx`):
- **Local/Remote sources**: Per-source offset tracking via `clientOffsetRef`, loads from IndexedDB
- **Server sources**: Unified global offset per server ID (`serverOffsetsRef`), single API call fetches mixed results
- **Refill trigger**: When `timelineQueue.length < PRELOAD_THRESHOLD (100)`, automatically loads next batch

```typescript
// ImageGrid.tsx lines ~299-350
const limit = BATCH_SIZE; // 50
if (selectedClientSources.length > 0) {
  const slice = sorted.slice(nextClientOffset, nextClientOffset + limit);
  clientHasMore = sorted.length > nextClientOffset + slice.length;
}
if (selectedServerIds.length > 0) {
  const perServerLimit = Math.ceil(limit / selectedServerIds.length);
  // Fetch via /api/server-sources/${serverId}/pictures?offset=X&limit=Y
}
```

**Why**: Server sources benefit from pre-sorted database queries (faster), while local/remote need per-source control.

### 2. Strict Timestamp Descending Order
**All images across sources** are merged into a single `timelineQueue` sorted by `modified` DESC (newest first). Users always see chronologically correct order, regardless of source load timing.

**Implementation**: `ImageGrid.tsx` re-sorts entire queue after each batch load:
```typescript
const nextQueue = [...currentQueue, ...newPictures].sort((a, b) => b.modified - a.modified);
```

### 3. File System Access API Permission Flow
**Critical**: Browser permissions are ephemeral. Always re-verify before accessing local files.

**Pattern** (`permissionUtils.ts`):
```typescript
if ((await handle.queryPermission({ mode: 'read' })) !== 'granted') {
  await handle.requestPermission({ mode: 'read' }); // Must be user-triggered
}
```

**UI**: `PermissionManager.tsx` listens for permission errors and shows re-auth prompts. Never bypass this flow.

### 4. Web Worker for Heavy Lifting
**Scan operations block main thread** if run synchronously. Always use `scan.worker.ts`:

```typescript
// App.tsx lines ~100-150
scanWorker.current.postMessage({ type: 'scan', sources, existingPictures });
scanWorker.current.onmessage = (e) => {
  if (e.data.type === 'progress') { /* update UI */ }
  if (e.data.type === 'complete') { /* apply diffs to IndexedDB */ }
};
```

**Worker responsibilities**: Recursively walk directories, parse EXIF (12 tags), compute diffs against existing DB state.

### 5. 3-Tier Thumbnail Cache (Backend)
**Problem**: Unlimited thumbnail sizes bloat cache; cache misses harm perf.

**Solution** (`server.cjs` lines ~20-100):
- Only generate 3 sizes: 400px (mobile), 800px (standard), 1600px (HiDPI)
- Frontend selects optimal size via `selectThumbnailSize(containerWidth, dpr)`
- Cache stored as WebP, LRU eviction when exceeding 500MB or 7-day TTL

```javascript
const THUMBNAIL_SIZES = { SMALL: 400, MEDIUM: 800, LARGE: 1600 };
const cacheKey = `${md5(sourceName + imagePath + width)}.webp`;
```

**Why**: 95%+ cache hit rate vs 30% with dynamic sizing.

---

## Development Workflows

### Local Development (Two-Terminal Setup)
```bash
# Terminal 1: Backend (serves images, proxies APIs)
node server.cjs  # Listens on :3889

# Terminal 2: Frontend dev server
npm run dev      # Vite on :5173, proxies /api to :3889
```

**Debugging Tips**:
- **Permission errors**: Check `PermissionManager.tsx` rendering, verify user gesture triggered request
- **Pagination bugs**: Add console logs in `ImageGrid.tsx` around `clientOffsetRef`/`serverOffsetsRef` updates
- **Worker crashes**: Check `scan.worker.ts` error handler, ensure EXIF parsing doesn't throw uncaught exceptions

### Build & Deploy
```bash
npm run build   # tsc -b && vite build → dist/
npm start       # Runs server.cjs, serves static from dist/ on :3889
```

**Docker**: `docker-compose.yml` mounts host dirs to `/server_images/<name>` - each subdir becomes a server source. No env vars needed.

---

## Data Model (Dexie)

### DataSource Table
```typescript
interface DataSource {
  id?: number;
  type: 'local' | 'remote' | 'server';
  name: string;
  path: any; // FileSystemDirectoryHandle | string URL
  enabled: number; // 1=active, 0=disabled
  includeSubfolders?: boolean;
  disabledFolders?: string[]; // Relative paths to skip
  remoteConfig?: RemoteConfig; // API config for remote sources
}
```

### Picture Table
```typescript
interface Picture {
  id?: number;
  sourceId: number; // FK to DataSource.id
  name: string;
  path: any; // FileSystemFileHandle | string URL
  modified: number; // Timestamp for sorting
  size?: number;
  width?: number; height?: number;
  exifMake?: string; exifModel?: string; exifCreateDate?: number;
  // ... 7 more EXIF fields stored by worker
}
// Indexes: [sourceId+modified] for efficient pagination queries
```

**Version History**: 12 migrations. Always increment version when changing schema. Add `.upgrade()` callback if data transform needed.

---

## Common Modification Scenarios

### Add New Data Source Type
1. Extend `DataSource` interface in `db/db.ts` (bump version if schema changes)
2. Add reducer in `store/slices/dataSourceSlice.ts` (e.g., `addSourceType`)
3. Create UI form in `components/` (follow `RemoteSourceDialog.tsx` pattern)
4. Update `scan.worker.ts` to handle new source logic

### Modify Thumbnail Sizes
1. Update `THUMBNAIL_SIZES` in `server.cjs`
2. Update matching constants in `ImageGrid.tsx` (`selectThumbnailSize` function)
3. Clear `thumb_cache/` dir to regenerate

### Add EXIF Field
1. Add field to `Picture` interface in `db/db.ts` (no index needed)
2. Extract field in `scan.worker.ts` (add to `exifr.parse()` tag list)
3. Display in `FullscreenViewer.tsx` metadata panel

---

## Safety Rules

1. **Never** modify files directly via terminal commands - use File System Access API
2. **Never** hardcode credentials - use `server.cjs` proxy with env vars
3. **Never** query IndexedDB without proper indexes - check `db.ts` compound indexes
4. **Never** skip Dexie version bumps when changing schema
5. **Never** block main thread - offload to `scan.worker.ts` for operations >50ms

---

## Key Design Decisions (from DESIGN_GOALS.md)

- **Pagination over full load**: Prevents UI freeze on 10k+ images
- **Global timestamp sort**: User sees newest first, regardless of source
- **Proactive refill at 100 items**: User never waits for loading
- **3-tier cache**: Optimal balance between cache size and hit rate
- **Worker-based scanning**: Keeps UI responsive during EXIF parsing

---

**Quick Reference**:
- State management: `src/store/slices/dataSourceSlice.ts` + `store.ts`
- Pagination logic: `src/components/ImageGrid.tsx` lines 195-400
- Permission flow: `src/utils/permissionUtils.ts` + `PermissionManager.tsx`
- Backend API: `server.cjs` lines 200-500 (server source endpoints)
- I18n: `src/locales/en.json`, `zh.json` (use `useTranslation()` hook)
