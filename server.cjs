const express = require('express');
const fetch = require('node-fetch');
const path = require('path');
const fs = require('fs');
const sharp = require('sharp');
const chokidar = require('chokidar');
require('dotenv').config();



const app = express();

app.use(express.json());

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
  const { sourceName, offset = 0, limit = 50, searchTerm = '' } = req.query;

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

  res.json({
    pictures: paginatedPictures,
    hasMore,
  });
});

// Health endpoint for container orchestration and healthchecks
app.get('/api/health', (req, res) => {
  res.status(200).json({ status: 'ok' });
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


// 只处理非 /api/ 路径的前端路由
app.get(/^\/(?!api\/).*/, (req, res) => {
  res.sendFile(path.join(__dirname, 'dist', 'index.html'));
});

// --- Server-Side Data Source Logic ---

const serverDataCache = {
  sources: [],
  pictures: [],
};
const serverSourceConfig = new Map(); // Maps source name to its real path

const CACHE_VERSION = 1;
const CACHE_FILE_PATH = path.join(__dirname, 'server-cache.json');

async function loadServerCache() {
  try {
    const raw = await fs.promises.readFile(CACHE_FILE_PATH, 'utf8');
    const payload = JSON.parse(raw);
    if (payload.version !== CACHE_VERSION) {
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
    version: CACHE_VERSION,
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
  if (!sourcesEnv) {
    return;
  }
  try {
    const sources = JSON.parse(sourcesEnv);
    const pathsToWatch = sources.map(s => s.path).filter(Boolean);
    if (pathsToWatch.length === 0) {
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
    console.error('Could not setup file watcher, failed to parse SERVER_SOURCES:', e);
  }
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
  if (!sourcesEnv) {
    console.log('SERVER_SOURCES environment variable not set. Skipping scan.');
    return;
  }

  try {
    const sources = JSON.parse(sourcesEnv);
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
  await loadServerCache();
  const sourcesEnv = process.env.SERVER_SOURCES;
  setupWatchersFromEnv(sourcesEnv);

  if (serverDataCache.sources.length === 0 || serverDataCache.pictures.length === 0) {
    await scanServerFolders();
  } else {
    console.log('Usingpersisted  server cache. Triggering background validation scan.');
    triggerRescan();
  }

  app.listen(3889, () => console.log('Server running on http://localhost:3889'));
}

startServer();
