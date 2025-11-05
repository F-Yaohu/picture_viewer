const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const chokidar = require('chokidar');

// 仅加载 .env 文件，避免从系统环境继承可能有问题的变量
require('dotenv').config({ override: false });

const app = express();

app.use(express.json());

// --- Thumbnail Cache Management ---
const THUMB_CACHE_DIR = path.join(__dirname, 'thumb_cache');
const CACHE_METADATA_FILE = path.join(THUMB_CACHE_DIR, '.cache_metadata.json');
const CACHE_VERSION = '1.0';
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const MAX_CACHE_SIZE_BYTES = 500 * 1024 * 1024; // 500 MB
const CACHE_CLEANUP_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

// Cache metadata: track creation/modification time, file size, access count
let cacheMetadata = {
  version: CACHE_VERSION,
  createdAt: Date.now(),
  entries: {} // Map: filename -> { createdAt, modifiedAt, size, accessCount }
};

async function ensureCacheDir() {
  try {
    await fs.promises.mkdir(THUMB_CACHE_DIR, { recursive: true });
  } catch (err) {
    console.error('Failed to create thumb_cache directory:', err);
  }
}

async function loadCacheMetadata() {
  try {
    const raw = await fs.promises.readFile(CACHE_METADATA_FILE, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed.version === CACHE_VERSION) {
      cacheMetadata = parsed;
      console.log(`Loaded cache metadata: ${Object.keys(cacheMetadata.entries).length} entries`);
    } else {
      console.log('Cache metadata version mismatch. Starting fresh.');
      cacheMetadata = { version: CACHE_VERSION, createdAt: Date.now(), entries: {} };
    }
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.warn('Failed to load cache metadata:', err.message);
    }
    cacheMetadata = { version: CACHE_VERSION, createdAt: Date.now(), entries: {} };
  }
}

async function saveCacheMetadata() {
  try {
    await fs.promises.writeFile(CACHE_METADATA_FILE, JSON.stringify(cacheMetadata, null, 2), 'utf8');
  } catch (err) {
    console.error('Failed to save cache metadata:', err);
  }
}

function recordCacheEntry(filename, size) {
  const now = Date.now();
  cacheMetadata.entries[filename] = {
    createdAt: now,
    modifiedAt: now,
    size: size,
    accessCount: 1
  };
}

function updateCacheEntryAccess(filename) {
  if (cacheMetadata.entries[filename]) {
    cacheMetadata.entries[filename].accessCount += 1;
    cacheMetadata.entries[filename].modifiedAt = Date.now();
  }
}

async function getThumbCacheKey(sourceName, imagePath, width) {
  const crypto = require('crypto');
  const key = `${sourceName}/${imagePath}/${width}`;
  const hash = crypto.createHash('md5').update(key).digest('hex');
  return `${hash}.webp`;
}

/**
 * LRU-based cache cleanup: remove oldest or least-accessed entries if cache exceeds size limit
 */
async function cleanupCacheIfNeeded() {
  try {
    const entries = await fs.promises.readdir(THUMB_CACHE_DIR);
    let totalSize = 0;
    const fileStats = {};

    for (const filename of entries) {
      if (filename === '.cache_metadata.json') continue;
      const filepath = path.join(THUMB_CACHE_DIR, filename);
      try {
        const stat = await fs.promises.stat(filepath);
        fileStats[filename] = stat.size;
        totalSize += stat.size;
      } catch (err) {
        // File might have been deleted, skip
      }
    }

    if (totalSize > MAX_CACHE_SIZE_BYTES) {
      console.log(`Cache size (${Math.round(totalSize / 1024 / 1024)}MB) exceeds limit. Cleaning up...`);
      
      // Sort by access time (oldest first) and access count (least accessed first)
      const sortedEntries = Object.entries(cacheMetadata.entries)
        .filter(([filename]) => fileStats[filename])
        .sort((a, b) => {
          // Primary: least accessed
          if (a[1].accessCount !== b[1].accessCount) {
            return a[1].accessCount - b[1].accessCount;
          }
          // Secondary: oldest
          return a[1].modifiedAt - b[1].modifiedAt;
        });

      let freedSize = 0;
      const targetSize = MAX_CACHE_SIZE_BYTES * 0.8; // Target 80% of max size
      
      for (const [filename] of sortedEntries) {
        if (freedSize >= totalSize - targetSize) break;
        
        const filepath = path.join(THUMB_CACHE_DIR, filename);
        try {
          const size = fileStats[filename];
          await fs.promises.unlink(filepath);
          freedSize += size;
          delete cacheMetadata.entries[filename];
          console.log(`  Removed cache entry: ${filename} (freed ${Math.round(size / 1024)}KB)`);
        } catch (err) {
          console.warn(`  Failed to remove cache entry ${filename}:`, err.message);
        }
      }
      
      console.log(`Cleanup complete. Freed ${Math.round(freedSize / 1024 / 1024)}MB.`);
      await saveCacheMetadata();
    }

    // Also cleanup expired entries (older than TTL and not accessed recently)
    const now = Date.now();
    const expiredEntries = Object.entries(cacheMetadata.entries)
      .filter(([, metadata]) => now - metadata.modifiedAt > CACHE_TTL_MS);

    if (expiredEntries.length > 0) {
      console.log(`Removing ${expiredEntries.length} expired cache entries (not accessed in 7 days)...`);
      for (const [filename] of expiredEntries) {
        const filepath = path.join(THUMB_CACHE_DIR, filename);
        try {
          await fs.promises.unlink(filepath);
          delete cacheMetadata.entries[filename];
        } catch (err) {
          console.warn(`Failed to remove expired entry ${filename}:`, err.message);
        }
      }
      await saveCacheMetadata();
    }
  } catch (err) {
    console.error('Cache cleanup error:', err);
  }
}

/**
 * Periodic cache maintenance: runs every 6 hours
 */
function startCacheMaintenanceTimer() {
  setInterval(async () => {
    console.log('Running scheduled cache maintenance...');
    await cleanupCacheIfNeeded();
  }, CACHE_CLEANUP_INTERVAL_MS);
}

// 静态资源托管（dist为React打包目录）
app.use(express.static(path.join(__dirname, 'dist')));

// 代理接口
app.post('/api/proxy', async (req, res) => {
  const { url, method, headers, body } = req.body;
  if (!url) return res.status(400).json({ error: 'URL is required' });

  try {
    const fetchOptions = {
      method: method || 'GET',
      headers: headers || {},
    };
    // 只有非GET才带body
    if (fetchOptions.method !== 'GET' && body) {
      fetchOptions.body = body;
    }
    const response = await fetch(url, fetchOptions);
    const contentType = response.headers.get('content-type');
    res.set('Access-Control-Allow-Origin', '*');
    res.status(response.status);
    if (contentType && contentType.includes('application/json')) {
      const data = await response.json();
      res.json(data);
    } else {
      const text = await response.text();
      res.send(text);
    }
  } catch (e) {
    res.status(500).json({ error: e.message });
  }
});

// --- New Server-Side Data Routes ---

app.get('/api/server-data', (req, res) => {
  res.json({ sources: serverDataCache.sources });
});

app.get('/api/server-pictures', (req, res) => {
  const { sourceName, offset = 0, limit = 50, searchTerm = '', thumbWidth = 200 } = req.query;

  let picturesToFilter = [];

  if (sourceName && sourceName !== 'all') {
    // Filter by a specific server source
    picturesToFilter = serverDataCache.pictures.filter(p => {
      const source = serverDataCache.sources.find(s => s.id === p.sourceId);
      return source && source.name === sourceName;
    });
  } else {
    // Use all server pictures
    picturesToFilter = serverDataCache.pictures;
  }

  // Apply search term
  if (searchTerm) {
    const lowercasedTerm = searchTerm.toLowerCase();
    picturesToFilter = picturesToFilter.filter(p => p.name.toLowerCase().includes(lowercasedTerm));
  }

  // Sort by modification date (newest first)
  picturesToFilter.sort((a, b) => b.modified - a.modified);

  const numOffset = parseInt(offset, 10);
  const numLimit = parseInt(limit, 10);

  const paginatedPictures = picturesToFilter.slice(numOffset, numOffset + numLimit);
  const hasMore = (numOffset + paginatedPictures.length) < picturesToFilter.length;

  // Enrich pictures with thumbnail URL
  const thumbSize = parseInt(thumbWidth, 10) || 200;
  const enrichedPictures = paginatedPictures.map(pic => {
    // Extract source name from the original path construction logic
    const source = serverDataCache.sources.find(s => s.id === pic.sourceId);
    const srcName = source ? source.name : '';
    
    // Build thumbnail URL: /api/server-images-thumb/<sourceName>/<imagePath>?width=<size>
    // The imagePath part of pic.path is the encoded subpath after the source name
    const pathMatch = pic.path.match(/^\/server-images\/([^/]+)\/(.+)$/);
    let thumbUrl = null;
    if (pathMatch && srcName) {
      const encodedSubPath = pathMatch[2];
      thumbUrl = `/api/server-images-thumb/${encodeURIComponent(srcName)}/${encodedSubPath}?width=${thumbSize}`;
    }

    return {
      ...pic,
      thumbUrl,
    };
  });

  res.json({
    pictures: enrichedPictures,
    hasMore,
  });
});

// Health endpoint for container orchestration and healthchecks
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
});

// Thumbnail generation endpoint: /api/server-images-thumb/<sourceName>/<imagePath>?width=200
// 使用 middleware 而不是直接的 app.get 来避免 Express 5 的通配符解析问题
app.use('/api/server-images-thumb/', async (req, res, next) => {
  if (req.method !== 'GET') return next();
  
  try {
    const width = Math.min(parseInt(req.query.width || 200), 400); // Cap width at 400px
    if (isNaN(width) || width < 50) {
      return res.status(400).json({ error: 'Invalid width parameter' });
    }

    // 获取去掉 /api/server-images-thumb/ 前缀后的路径
    const pathParts = req.path.split('/').filter(p => p);
    if (pathParts.length < 2) {
      return res.status(400).json({ error: 'Invalid request: source name and image path required' });
    }

    const sourceName = pathParts[0];
    const imageSubPath = pathParts.slice(1).join('/');
    const sourcePath = serverSourceConfig.get(decodeURIComponent(sourceName));
    
    if (!sourcePath) {
      return res.status(404).json({ error: 'Source not found' });
    }

    const imagePath = path.join(sourcePath, decodeURIComponent(imageSubPath));
    
    // Security check
    if (!path.resolve(imagePath).startsWith(path.resolve(sourcePath))) {
      return res.status(403).json({ error: 'Forbidden' });
    }

    // Check if file exists
    try {
      await fs.promises.access(imagePath);
    } catch {
      return res.status(404).json({ error: 'Image not found' });
    }

    const cacheKey = await getThumbCacheKey(sourceName, imageSubPath, width);
    const cachePath = path.join(THUMB_CACHE_DIR, cacheKey);

    // Serve from cache if exists
    try {
      await fs.promises.access(cachePath);
      updateCacheEntryAccess(cacheKey);
      res.set('Cache-Control', 'public, max-age=86400');
      return res.sendFile(cachePath);
    } catch {
      // Cache miss, generate thumbnail
    }

    // Generate thumbnail using sharp
    const metadata = await sharp(imagePath).metadata();
    if (!metadata.width || !metadata.height) {
      return res.status(400).json({ error: 'Cannot read image metadata' });
    }

    const aspectRatio = metadata.width / metadata.height;
    const thumbHeight = Math.round(width / aspectRatio);

    // Resize and convert to WebP for efficient storage/delivery
    const thumbBuffer = await sharp(imagePath)
      .resize(width, thumbHeight, { fit: 'cover', position: 'center' })
      .webp({ quality: 75 })
      .toBuffer();

    // Save to cache
    await fs.promises.writeFile(cachePath, thumbBuffer);
    recordCacheEntry(cacheKey, thumbBuffer.length);
    await saveCacheMetadata();
    
    // Cleanup if cache is getting too large
    await cleanupCacheIfNeeded();

    // Serve to client with long cache header
    res.set('Cache-Control', 'public, max-age=86400');
    res.set('Content-Type', 'image/webp');
    res.send(thumbBuffer);
  } catch (e) {
    console.error('Thumbnail generation error:', e);
    res.status(500).json({ error: 'Failed to generate thumbnail' });
  }
});

// A robust way to handle image serving that avoids path-to-regexp parsing issues.
app.use('/api/server-images', (req, res) => {
  // req.path will contain the part of the URL after '/api/server-images/'
  // e.g., for a request to '/api/server-images/MySource/Sub/image.jpg', req.path is '/MySource/Sub/image.jpg'
  const pathParts = req.path.split('/').filter(p => p); // Split and remove empty parts
  
  if (pathParts.length < 2) {
    return res.status(400).send('Invalid request: source name and image path are required.');
  }

  const sourceName = pathParts[0];
  const imageSubPath = pathParts.slice(1).join('/');

  const sourcePath = serverSourceConfig.get(decodeURIComponent(sourceName));
  if (!sourcePath) {
    return res.status(404).send('Source not found');
  }

  const imagePath = path.join(sourcePath, decodeURIComponent(imageSubPath));
  
  // Security check to prevent path traversal attacks
  if (path.resolve(imagePath).startsWith(path.resolve(sourcePath))) {
    res.sendFile(imagePath, (err) => {
      if (err) {
        // If the client aborts the request, the connection is already severed.
        // We cannot send a new response, so we just log it and exit.
        if (err.code === 'ECONNABORTED') {
          console.warn(`Client aborted request for: ${path.basename(imagePath)}`);
          return;
        }
        // For other errors (e.g., file deleted after scan), send a 404.
        console.error(`Failed to send file: ${imagePath}`, err);
        res.status(404).send('Image not found');
      }
    });
  } else {
    res.status(403).send('Forbidden');
  }
});

// 前端路由处理（必须放在所有 API 路由之后）
// 使用 middleware 而不是 app.get('*') 来避免 path-to-regexp 问题
app.use((req, res) => {
  // 排除 API 路由（由前面的处理程序已处理）
  if (!req.path.startsWith('/api/')) {
    res.sendFile(path.join(__dirname, 'dist', 'index.html'));
  } else {
    res.status(404).json({ error: 'API endpoint not found' });
  }
});

// --- Server-Side Data Source Logic ---

const serverDataCache = {
  sources: [],
  pictures: [],
};
const serverSourceConfig = new Map(); // Maps source name to its real path

const SERVER_CACHE_VERSION = 1;
const CACHE_FILE_PATH = path.join(__dirname, 'server-cache.json');

async function loadServerCache() {
  try {
    const raw = await fs.promises.readFile(CACHE_FILE_PATH, 'utf8');
    const payload = JSON.parse(raw);
    if (payload.version !== SERVER_CACHE_VERSION) {
      console.log('Cache version mismatch. Ignoring stored cache.');
      return;
    }
    if (Array.isArray(payload.sources) && Array.isArray(payload.pictures)) {
      serverDataCache.sources = payload.sources;
      serverDataCache.pictures = payload.pictures;
    }
    if (Array.isArray(payload.sourceConfig)) {
      serverSourceConfig.clear();
      for (const [name, sourcePath] of payload.sourceConfig) {
        serverSourceConfig.set(name, sourcePath);
      }
    }
    console.log(`Loaded cached server data: ${serverDataCache.sources.length} sources / ${serverDataCache.pictures.length} pictures.`);
  } catch (err) {
    if (err.code !== 'ENOENT') {
      console.error('Failed to load server cache:', err);
    }
  }
}

async function persistServerCache() {
  const payload = {
    version: SERVER_CACHE_VERSION,
    sources: serverDataCache.sources,
    pictures: serverDataCache.pictures,
    sourceConfig: Array.from(serverSourceConfig.entries()),
    updatedAt: Date.now(),
  };
  const tmpPath = `${CACHE_FILE_PATH}.tmp`;
  try {
    await fs.promises.writeFile(tmpPath, JSON.stringify(payload), 'utf8');
    await fs.promises.rename(tmpPath, CACHE_FILE_PATH);
  } catch (err) {
    console.error('Failed to persist server cache:', err);
    try {
      await fs.promises.unlink(tmpPath);
    } catch (_) {
      // ignore cleanup failure
    }
  }
}

// --- New state variables for scan management ---
let isScanningServer = false;
let rescanTimer = null;
const RESCAN_DEBOUNCE_DELAY = 5000; // 5 seconds

function setupWatchersFromEnv(sourcesEnv) {
  (async () => {
    try {
      let sources = null;
      if (sourcesEnv) {
        try {
          sources = JSON.parse(sourcesEnv);
        } catch (e) {
          console.error('Failed to parse SERVER_SOURCES JSON for watcher, falling back to auto-discovery:', e);
          sources = null;
        }
      }

      if (!sources) {
        const mountRoot = '/server_images';
        try {
          const entries = await fs.promises.readdir(mountRoot, { withFileTypes: true });
          sources = entries.filter(en => en.isDirectory()).map(en => ({ name: en.name, path: path.join(mountRoot, en.name) }));
        } catch (err) {
          if (err.code === 'ENOENT') {
            console.log('No mounted server image folders found under /server_images. Skipping watchers.');
          } else {
            console.warn('No mounted server image folders found under', mountRoot);
          }
          sources = [];
        }
      }

      const pathsToWatch = sources.map(s => s.path).filter(Boolean);
      if (pathsToWatch.length === 0) {
        console.log('No server sources to watch.');
        return;
      }
      console.log('Watching paths for changes:', pathsToWatch);
      const watcher = chokidar.watch(pathsToWatch, {
        ignored: /(^|[\/\\])\../,
        persistent: true,
        ignoreInitial: true,
      });
      watcher.on('add', filePath => { console.log(`File ${filePath} has been added`); triggerRescan(); });
      watcher.on('change', filePath => { console.log(`File ${filePath} has been changed`); triggerRescan(); });
      watcher.on('unlink', filePath => { console.log(`File ${filePath} has been removed`); triggerRescan(); });
    } catch (e) {
      console.error('Could not setup file watcher for server images:', e);
    }
  })();
}

function triggerRescan() {
  // If a scan is already in progress, do nothing.
  if (isScanningServer) {
    console.log('Scan is already in progress. New scan trigger ignored.');
    return;
  }

  // Clear any existing timer to debounce the scan request.
  if (rescanTimer) {
    clearTimeout(rescanTimer);
  }

  console.log(`Scan triggered. Waiting ${RESCAN_DEBOUNCE_DELAY}ms for more changes...`);
  rescanTimer = setTimeout(async () => {
    isScanningServer = true;
    try {
      await scanServerFolders();
    } finally {
      isScanningServer = false;
      console.log('Debounced scan finished.');
    }
  }, RESCAN_DEBOUNCE_DELAY);
}

async function scanServerFolders() {
  console.log('Starting server-side folder scan...');
  const sourcesEnv = process.env.SERVER_SOURCES;
  let sources = null;
  if (sourcesEnv) {
    try {
      sources = JSON.parse(sourcesEnv);
    } catch (e) {
      console.error('Failed to parse SERVER_SOURCES JSON, falling back to auto-discovery:', e);
      sources = null;
    }
  }

  // If SERVER_SOURCES not provided, auto-discover subfolders under /server_images
  if (!sources) {
    try {
      const mountRoot = '/server_images';
      const entries = await fs.promises.readdir(mountRoot, { withFileTypes: true });
      const discovered = entries.filter(en => en.isDirectory()).map(en => ({ name: en.name, path: path.join(mountRoot, en.name) }));
      if (discovered.length === 0) {
        console.log(`No subfolders found under ${mountRoot}. Server sources disabled. If you intended to provide SERVER_SOURCES via environment, set it in docker-compose.`);
        // Gracefully skip server sources - do not fail
        sources = [];
      } else {
        sources = discovered;
        console.log('Auto-discovered server sources from container mount:', sources.map(s => s.name));
      }
    } catch (err) {
      if (err.code === 'ENOENT') {
        console.log(`No mounted /server_images directory found. Server sources disabled. This is normal for development without server sources.`);
        // Gracefully skip - directory doesn't exist
        sources = [];
      } else {
        console.error('Failed to access server sources under /server_images:', err);
        // Gracefully skip on other errors too
        sources = [];
      }
    }
  }

  try {
    let pictureIdCounter = 0;
    const nextSources = [];
    const nextPictures = [];
    const nextSourceConfig = new Map();

    for (const source of sources) {
      if (!source.name || !source.path) continue;

  const sourceRootPath = source.path;
      const sourceId = nextSources.length;
      let sourcePictureCount = 0;
      const sourceDto = {
        id: sourceId,
        type: 'server',
        name: source.name,
        pictureCount: 0,
      };
      nextSources.push(sourceDto);
      nextSourceConfig.set(source.name, sourceRootPath);

      const files = await getFilesRecursively(sourceRootPath);
      for (const file of files) {
        try {
          const metadata = await sharp(file).metadata();
          const stats = fs.statSync(file);
          const relativePath = path.relative(sourceRootPath, file);
          // A robust way to convert file system path to URL path, works on Windows and Linux.
          const urlSubPath = relativePath.replace(/\\/g, '/');
          // Encode each path segment to produce safe URLs (spaces, unicode, etc.)
          const encodedSubPath = urlSubPath.split('/').map(encodeURIComponent).join('/');

          nextPictures.push({
            id: pictureIdCounter++,
            sourceId: sourceId,
            name: path.basename(file),
            // Expose images via nginx at /server-images/<SourceName>/... for efficient static serving
            path: `/server-images/${encodeURIComponent(source.name)}/${encodedSubPath}`,
            modified: stats.mtime.getTime(),
            size: stats.size,
            width: metadata.width,
            height: metadata.height,
          });
          sourcePictureCount += 1;
        } catch (e) {
          console.warn(`Could not process file ${file}: ${e.message}`);
        }
      }
      sourceDto.pictureCount = sourcePictureCount;
    }
    serverDataCache.sources = nextSources;
    serverDataCache.pictures = nextPictures;
    serverSourceConfig.clear();
    for (const [name, sourcePath] of nextSourceConfig.entries()) {
      serverSourceConfig.set(name, sourcePath);
    }
    await persistServerCache();
    console.log(`Scan complete. Found ${serverDataCache.sources.length} sources and ${serverDataCache.pictures.length} pictures.`);
  } catch (e) {
    console.error('Failed to parse SERVER_SOURCES or scan folders:', e);
  }
}

async function getFilesRecursively(dir) {
  const entries = await fs.promises.readdir(dir, { withFileTypes: true });
  const files = await Promise.all(entries.flatMap(async (entry) => {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      return getFilesRecursively(fullPath);
    }
    const supportedExtensions = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.svg'];
    if (supportedExtensions.some(ext => entry.name.toLowerCase().endsWith(ext))) {
      return fullPath;
    }
    return [];
  }));
  return files.flat();
}

// --- Server Startup ---

async function startServer() {
  // Initialize cache system
  await ensureCacheDir();
  await loadCacheMetadata();
  startCacheMaintenanceTimer();
  
  await loadServerCache();
  const sourcesEnv = process.env.SERVER_SOURCES;
  setupWatchersFromEnv(sourcesEnv);

  // Scan if cache is empty, or trigger background refresh if cache exists
  if (serverDataCache.sources.length === 0) {
    console.log('No cached server sources found. Attempting to scan...');
    await scanServerFolders();
    if (serverDataCache.sources.length === 0) {
      console.log('No server sources available. Application running without server data sources (this is normal for development).');
    }
  } else {
    console.log('Using persisted server cache. Triggering background validation scan.');
    triggerRescan();
  }

  app.listen(3889, () => console.log('Server running on http://localhost:3889'));
}

startServer();
