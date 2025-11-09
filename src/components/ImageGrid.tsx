import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
// ImageListItemBar removed; overlay implemented in PictureCard
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { db, type Picture, type DataSource } from '../db/db';
import { imageUrlCache } from '../utils/imageUrlCache';
import { groupAndLayoutPictures } from '../utils/layoutUtils';

// Thumbnail size presets (must match server.cjs THUMBNAIL_SIZES)
const THUMBNAIL_SIZES = { SMALL: 400, MEDIUM: 800, LARGE: 1600 } as const;

/**
 * Select optimal thumbnail size based on container width and device pixel ratio.
 * Returns one of the standard sizes (400, 800, 1600) to maximize cache hit rate.
 * 
 * @param containerWidth - Current grid container width in CSS pixels
 * @param dpr - Device pixel ratio (window.devicePixelRatio)
 * @returns One of: 400, 800, or 1600
 */
function selectThumbnailSize(containerWidth: number, dpr: number = 1): number {
  // Calculate required physical pixels for optimal quality
  const requiredWidth = Math.round(containerWidth * Math.max(1, dpr));
  
  // Select smallest preset that meets or exceeds required width
  if (requiredWidth <= THUMBNAIL_SIZES.SMALL) return THUMBNAIL_SIZES.SMALL;
  if (requiredWidth <= THUMBNAIL_SIZES.MEDIUM) return THUMBNAIL_SIZES.MEDIUM;
  return THUMBNAIL_SIZES.LARGE;
}

// Minimal ResizeObserver hook to avoid adding an extra dependency.
function useResizeObserver(ref: any, callback: (entry: ResizeObserverEntry) => void) {
  useEffect(() => {
    const el = ref.current;
    if (!el || typeof ResizeObserver === 'undefined') return;
    const ro = new ResizeObserver((entries) => {
      if (entries[0]) callback(entries[0]);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [ref, callback]);
}

// Debounce hook for performance optimization
function useDebounce<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState<T>(value);

  useEffect(() => {
    const handler = setTimeout(() => {
      setDebouncedValue(value);
    }, delay);

    return () => {
      clearTimeout(handler);
    };
  }, [value, delay]);

  return debouncedValue;
}



const PictureCard = ({ data, width, height }: { data: Picture, width: number, height: number }) => {
  // Determine initial image source based on picture type
  // For server source pictures with thumbUrl, use thumbnail first; for local, use cache or undefined
  const getInitialImageUrl = () => {
    if (typeof data.path === 'string') {
      // Server source: prioritize thumbUrl if available, fallback to original path
      const anyData = data as any;
      return anyData.thumbUrl ? anyData.thumbUrl : data.path;
    }
    // Local file: use cached thumbnail if available
    return imageUrlCache.getThumb(data.id!, Math.round(width));
  };

  const [imageUrl, setImageUrl] = useState<string | undefined>(getInitialImageUrl());
  const containerRef = useRef<HTMLDivElement | null>(null);
  const imgRef = useRef<HTMLImageElement | null>(null);

  // Handle image load failure: fallback to original image for server sources
  const handleImageError = () => {
    if (typeof data.path === 'string') {
      const anyData = data as any;
      const currentUrl = imageUrl;
      const thumbUrl = anyData.thumbUrl;
      const originalPath = data.path;

      // If we loaded a thumbnail and it failed, fallback to original
      if (currentUrl === thumbUrl && thumbUrl !== originalPath) {
        console.warn(`Thumbnail load failed for ${data.name}, falling back to original image`);
        setImageUrl(originalPath);
      }
    }
  };

  // Create a small thumbnail for local files only when the card becomes visible.
  useEffect(() => {
    if (typeof data.path === 'string') {
      // Server URL — thumbnail loading handled via img onerror
      return;
    }

    let mounted = true;
    let observer: IntersectionObserver | null = null;

    const ensureThumb = async () => {
      if (!mounted) return;
      const existing = imageUrlCache.getThumb(data.id!, Math.round(width));
      if (existing) {
        setImageUrl(existing);
        return;
      }

      try {
        const fileHandle = data.path as unknown as FileSystemFileHandle;
        const file = await fileHandle.getFile();
        // CreateImageBitmap is often faster than loading into <img>
        const bitmap = await createImageBitmap(file);
        // Target thumbnail width based on layout width and device pixel ratio
        const dpr = Math.max(1, window.devicePixelRatio || 1);
        const targetW = Math.max(40, Math.round(width * dpr));
        const scale = targetW / bitmap.width;
        const targetH = Math.max(40, Math.round(bitmap.height * scale));

        const canvas = document.createElement('canvas');
        canvas.width = targetW;
        canvas.height = targetH;
        const ctx = canvas.getContext('2d');
        if (ctx) {
          ctx.drawImage(bitmap, 0, 0, targetW, targetH);
          // toBlob may be async; wrap in promise
          const blob: Blob | null = await new Promise(resolve => canvas.toBlob(resolve as any, 'image/webp', 0.75));
          if (blob) {
            const objUrl = URL.createObjectURL(blob);
            imageUrlCache.setThumb(data.id!, Math.round(width), objUrl);
            if (mounted) setImageUrl(objUrl);
          }
        }
        bitmap.close();
      } catch (e) {
        console.warn('Thumbnail generation failed, falling back to full object URL', e);
        try {
          const fileHandle = data.path as unknown as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          const fullUrl = URL.createObjectURL(file);
          imageUrlCache.set(data.id!, fullUrl);
          if (mounted) setImageUrl(fullUrl);
        } catch (err) { console.error('Failed to create fallback object URL:', err); }
      }
    };

    // Only generate thumbnail when the element is visible to avoid decoding many images at once
    const el = containerRef.current;
    if (el && typeof IntersectionObserver !== 'undefined') {
      observer = new IntersectionObserver(entries => {
        for (const entry of entries) {
          if (entry.isIntersecting) {
            // stop observing once visible
            observer?.disconnect();
            ensureThumb();
          }
        }
      }, { rootMargin: '400px' });
      observer.observe(el);
    } else {
      // Fallback: just ensure thumb immediately
      ensureThumb();
    }

    return () => { mounted = false; observer?.disconnect(); };
  }, [data, width]);

  if (!imageUrl) {
    // Render a placeholder with correct pre-calculated height.
    return <div ref={containerRef} style={{ width, height, backgroundColor: '#eee', borderRadius: '6px' }} />;
  }

  return (
    <div ref={containerRef}>
      <Box sx={{ position: 'relative', cursor: 'pointer', borderRadius: 1, overflow: 'hidden', width, height, '&:hover .overlay': { opacity: 1 } }}>
        <img 
          ref={imgRef}
          src={imageUrl} 
          alt={data.name} 
          loading="lazy" 
          decoding="async" 
          onError={handleImageError}
          style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} 
        />
        <Box className="overlay" sx={{ position: 'absolute', left: 0, right: 0, bottom: 0, p: 1, opacity: 0, transition: 'opacity 200ms ease-in-out', background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0) 100%)' }}>
          <Typography variant="body2" color="white" noWrap>{data.name}</Typography>
          <Typography variant="caption" color="white">{new Date(data.modified).toLocaleDateString()}</Typography>
        </Box>
      </Box>
    </div>
  );
};

interface ImageGridProps {
  dataSources: DataSource[];
  selectedSourceIds: number[];
  searchTerm: string;
  serverSources: DataSource[];
  onPictureClick: (picture: Picture) => void;
  onPicturesLoaded: (pictures: Picture[]) => void;
  // 可配置布局参数
  rowHeight?: number; // 目标行高（px），默认 220
  gap?: number; // 图片间隙（px），默认 12
  groupBy?: 'day' | 'week' | 'month'; // 分组粒度，默认 'day'
}

export default function ImageGrid({ dataSources, selectedSourceIds, searchTerm, serverSources, onPictureClick, onPicturesLoaded, rowHeight = 220, gap = 12, groupBy = 'day' }: ImageGridProps) {
  const { t } = useTranslation();
  const [items, setItems] = useState<Picture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasMoreRef = useRef(true);
  const clientOffsetRef = useRef(0);
  const serverOffsetRef = useRef(0); // Changed: single offset for unified server query
  const filterVersionRef = useRef(0);
  const isBatchLoadingRef = useRef(false);
  const pendingAnimationRef = useRef<number | null>(null);
  const BATCH_SIZE = 50; // Base batch size per request
  const INITIAL_LOAD_MULTIPLIER = 3; // Load 3x on initial load for better distribution
  const MIN_ROWS_THRESHOLD = 3; // Minimum rows before triggering auto-refill
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerWidth, setContainerWidth] = useState<number>(800);
  const ROW_HEIGHT = rowHeight;
  const GAP = gap;
  const [rows, setRows] = useState<Array<{ label: string; rows: Array<Array<{ item: Picture; width: number; height: number }>> }>>([]);

  const clientSourceIdSet = useMemo(() => {
    const set = new Set<number>();
    dataSources.forEach(source => {
      if (typeof source.id === 'number') set.add(source.id);
    });
    return set;
  }, [dataSources]);

  const serverSourceIdSet = useMemo(() => {
    const set = new Set<number>();
    serverSources.forEach(source => {
      if (typeof source.id === 'number') set.add(source.id);
    });
    return set;
  }, [serverSources]);

  const selectedClientIds = useMemo(
    () => selectedSourceIds.filter(id => clientSourceIdSet.has(id)),
    [selectedSourceIds, clientSourceIdSet],
  );

  const selectedServerIds = useMemo(
    () => selectedSourceIds.filter(id => serverSourceIdSet.has(id)),
    [selectedSourceIds, serverSourceIdSet],
  );

  const selectedSourceIdSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);

  const sourceConfigMap = useMemo(() => {
    const map = new Map<number, { disabledFolders: string[] }>();
    dataSources.forEach(source => {
      if (typeof source.id === 'number') {
        map.set(source.id, { disabledFolders: source.disabledFolders ?? [] });
      }
    });
    return map;
  }, [dataSources]);

  const shouldDisplayPicture = useCallback((picture: Picture) => {
    const sourceId = picture.sourceId;
    if (sourceId === null || sourceId === undefined || !selectedSourceIdSet.has(sourceId)) {
      return false;
    }

    const config = sourceConfigMap.get(sourceId);
    if (!config || config.disabledFolders.length === 0) {
      return true;
    }

    const relativePath = picture.relativePath;
    if (!relativePath) {
      // Older records may not have relativePath; keep them visible until rescanned.
      return true;
    }

    const folderPath = (() => {
      const lastSlash = relativePath.lastIndexOf('/');
      return lastSlash >= 0 ? relativePath.slice(0, lastSlash) : '';
    })();

    return !config.disabledFolders.some(folder => (
      folder.length > 0 && (
        folder === folderPath ||
        folderPath.startsWith(`${folder}/`) ||
        relativePath.startsWith(`${folder}/`)
      )
    ));
  }, [selectedSourceIdSet, sourceConfigMap]);

  useEffect(() => {
    setItems(currentItems => {
      const filtered = currentItems.filter(item => shouldDisplayPicture(item));
      return filtered.length === currentItems.length ? currentItems : filtered;
    });
  }, [shouldDisplayPicture]);

  useEffect(() => () => {
    if (pendingAnimationRef.current !== null) {
      cancelAnimationFrame(pendingAnimationRef.current);
      pendingAnimationRef.current = null;
    }
  }, []);

  // Helper: Generate unique key for picture deduplication
  const getKey = useCallback((p: Picture) => {
    if (p.relativePath) return `${p.sourceId}|${p.relativePath}`;
    if (typeof p.path === 'string') return `${p.sourceId}|${p.path}`;
    return `${p.sourceId}|${p.name}`;
  }, []);

  // Load pictures from local/remote sources (IndexedDB)
  const loadClientPictures = useCallback(async (
    limit: number,
    offset: number,
    searchTermLower: string
  ): Promise<{ pictures: Picture[]; hasMore: boolean; newOffset: number }> => {
    if (selectedClientIds.length === 0) {
      return { pictures: [], hasMore: false, newOffset: offset };
    }

    let collection = db.pictures.where('sourceId').anyOf(selectedClientIds);
    if (searchTermLower) {
      collection = collection.filter(p => p.name.toLowerCase().includes(searchTermLower));
    }
    const sorted = await collection.sortBy('modified');
    sorted.reverse();
    
    const slice = sorted.slice(offset, offset + limit);
    const hasMore = sorted.length > offset + slice.length;
    const newOffset = offset + slice.length;
    
    return { pictures: slice, hasMore, newOffset };
  }, [selectedClientIds]);

  // Load pictures from server sources (API) - unified query for all selected servers
  const loadServerPictures = useCallback(async (
    limit: number,
    offset: number,
    trimmedSearch: string
  ): Promise<{ pictures: Picture[]; hasMore: boolean; newOffset: number }> => {
    if (selectedServerIds.length === 0) {
      return { pictures: [], hasMore: false, newOffset: offset };
    }

    try {
      // Unified query: all server sources in one request
      const sourceIdsParam = selectedServerIds.join(',');
      const params = new URLSearchParams({
        sourceIds: sourceIdsParam,
        offset: String(offset),
        limit: String(limit),
      });
      if (trimmedSearch) params.set('searchTerm', trimmedSearch);
      
      const response = await fetch(`/api/server-pictures?${params.toString()}`);
      if (!response.ok) throw new Error(`Server responded ${response.status}`);
      
      const data = await response.json();
      const pictures = (data.pictures || []).map((pic: any) => {
        // Construct thumbnail URL on frontend based on size needs
        const source = serverSources.find(s => s.id === pic.sourceId);
        const srcName = source?.name || '';
        const thumbSize = selectThumbnailSize(containerWidth, window.devicePixelRatio);
        const thumbUrl = pic.thumbPath 
          ? `/api/server-images-thumb/${encodeURIComponent(srcName)}/${pic.thumbPath}?width=${thumbSize}`
          : null;
        
        return { 
          ...pic, 
          thumbUrl,
          sourceId: pic.sourceId 
        };
      });
      
      const newOffset = offset + pictures.length;
      return { pictures, hasMore: data.hasMore || false, newOffset };
    } catch (error) {
      console.error('Failed to load server pictures', error);
      return { pictures: [], hasMore: false, newOffset: offset };
    }
  }, [selectedServerIds, serverSources, containerWidth]);

  // Main pagination logic
  const loadMoreItems = useCallback(async () => {
    if (isBatchLoadingRef.current || !hasMoreRef.current) return;
    
    isBatchLoadingRef.current = true;
    const version = filterVersionRef.current;
    
    // Use larger batch size for initial load to ensure good distribution across sources
    const isInitialLoad = clientOffsetRef.current === 0 && serverOffsetRef.current === 0;
    const limit = isInitialLoad ? BATCH_SIZE * INITIAL_LOAD_MULTIPLIER : BATCH_SIZE;
    
    const trimmedSearch = searchTerm.trim();
    const searchTermLower = trimmedSearch.toLowerCase();

    try {
      // Load from both client and server sources in parallel
      const [clientResult, serverResult] = await Promise.all([
        loadClientPictures(limit, clientOffsetRef.current, searchTermLower),
        loadServerPictures(limit, serverOffsetRef.current, trimmedSearch)
      ]);

      // Check if filter changed during loading
      if (filterVersionRef.current !== version) {
        isBatchLoadingRef.current = false;
        return;
      }

      // Update offsets
      clientOffsetRef.current = clientResult.newOffset;
      serverOffsetRef.current = serverResult.newOffset;

      // Merge and sort by timestamp (newest first)
      const incoming = [...clientResult.pictures, ...serverResult.pictures];
      incoming.sort((a, b) => b.modified - a.modified);

      // Deduplicate and filter
      const seen = new Set<string>();
      const allowedBatch: Picture[] = [];
      for (const p of incoming) {
        if (!shouldDisplayPicture(p)) continue;
        const k = getKey(p);
        if (!seen.has(k)) {
          seen.add(k);
          allowedBatch.push(p);
        }
      }

      const clientHasMore = clientResult.hasMore;
      const serverHasMore = serverResult.hasMore;
      hasMoreRef.current = clientHasMore || serverHasMore;

      // If no new items but more data available, retry
      if (allowedBatch.length === 0) {
        isBatchLoadingRef.current = false;
        if (hasMoreRef.current && pendingAnimationRef.current === null) {
          pendingAnimationRef.current = window.requestAnimationFrame(() => {
            pendingAnimationRef.current = null;
            void loadMoreItems();
          });
        }
        return;
      }

      // Add to items list
      setItems(currentItems => {
        if (filterVersionRef.current !== version) return currentItems;
        if (currentItems.length === 0) return allowedBatch;
        
        const existing = new Set<string>(currentItems.map(it => getKey(it)));
        const toAdd = allowedBatch.filter(p => !existing.has(getKey(p)));
        return toAdd.length > 0 ? [...currentItems, ...toAdd] : currentItems;
      });

    } catch (error) {
      console.error('Failed to load pictures batch', error);
      hasMoreRef.current = false;
    } finally {
      isBatchLoadingRef.current = false;
    }
  }, [BATCH_SIZE, searchTerm, loadClientPictures, loadServerPictures, shouldDisplayPicture, getKey]);
  
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Resize observer for container width with debouncing for performance
  useLayoutEffect(() => {
    if (containerRef.current) setContainerWidth(containerRef.current.clientWidth);
  }, []);
  useResizeObserver(containerRef, (entry) => {
    setContainerWidth(entry.contentRect.width);
  });

  // Debounce container width to avoid excessive layout recalculations during resize
  const debouncedContainerWidth = useDebounce(containerWidth, 150);

  // Build justified rows grouped by date whenever items or debounced container width change
  useEffect(() => {
    const layouts = groupAndLayoutPictures(items, debouncedContainerWidth, ROW_HEIGHT, GAP, groupBy);
    setRows(layouts);
  }, [items, debouncedContainerWidth, ROW_HEIGHT, GAP, groupBy]);

  // Auto-refill: if rendered rows are too few and more data available, load more
  useEffect(() => {
    // Count total rows across all groups
    const totalRows = rows.reduce((sum, group) => sum + group.rows.length, 0);
    
    // If we have very few rows but more data available, trigger loading
    if (totalRows > 0 && totalRows < MIN_ROWS_THRESHOLD && hasMoreRef.current && !isBatchLoadingRef.current) {
      console.log(`Auto-refill triggered: only ${totalRows} rows rendered, loading more...`);
      loadMoreItems();
    }
  }, [rows, loadMoreItems]);

  useEffect(() => {
    filterVersionRef.current += 1;
    if (pendingAnimationRef.current !== null) {
      cancelAnimationFrame(pendingAnimationRef.current);
      pendingAnimationRef.current = null;
    }
    isBatchLoadingRef.current = false;
    clientOffsetRef.current = 0;
    serverOffsetRef.current = 0; // Reset unified server offset
    setItems([]);

    if (selectedClientIds.length === 0 && selectedServerIds.length === 0) {
      hasMoreRef.current = false;
      setIsLoading(false);
      return;
    }

    hasMoreRef.current = true;
    setIsLoading(true);
    loadMoreItems().finally(() => {
      setIsLoading(false);
    });
  }, [selectedClientIds, selectedServerIds, searchTerm]); // Remove loadMoreItems from deps

  // IntersectionObserver to trigger loading more when sentinel is visible
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting && hasMoreRef.current) {
          loadMoreItems();
        }
      });
    }, { 
      root: null, 
      rootMargin: '800px' // Increased from 400px for earlier preloading
    });
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length]); // Remove loadMoreItems from deps

  useEffect(() => {
    onPicturesLoaded(items);
  }, [items, onPicturesLoaded]);


  if (isLoading) return <Typography>Loading...</Typography>;
  if (!isLoading && selectedClientIds.length === 0 && selectedServerIds.length === 0) {
    return <Typography>{t('select_sources_prompt')}</Typography>;
  }
  if (!isLoading && items.length === 0 && !hasMoreRef.current) return <Typography>{t('no_pictures_for_selection')}</Typography>;

  return (
    <div ref={containerRef}>
      {rows.map((group, groupIndex) => (
        <div key={groupIndex} style={{ marginBottom: GAP }}>
          {group.label && (
            <div style={{ textAlign: 'center', margin: '6px 0' }}>
              <Typography variant="caption" color="text.secondary">{group.label}</Typography>
            </div>
          )}
          {group.rows.map((row, rowIndex) => (
            <div key={rowIndex} style={{ display: 'flex', gap: GAP, marginBottom: GAP }}>
              {row.map(({ item, width, height }) => (
                <div key={item.id} onClick={() => onPictureClick(item)} style={{ width, height }}>
                  <PictureCard data={item} width={width} height={height} />
                </div>
              ))}
            </div>
          ))}
        </div>
      ))}
      {/* sentinel element used to trigger loading more items */}
      <div ref={sentinelRef} style={{ height: 1 }} />
    </div>
  );
}