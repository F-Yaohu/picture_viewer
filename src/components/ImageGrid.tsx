import { useState, useEffect, useCallback, useRef, useLayoutEffect, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
// ImageListItemBar removed; overlay implemented in PictureCard
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { db, type Picture, type DataSource } from '../db/db';
import { imageUrlCache } from '../utils/imageUrlCache';

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



const PictureCard = ({ data, width, height }: { data: Picture, width: number, height: number }) => {
  const [imageUrl, setImageUrl] = useState<string | undefined>(() => {
    // For remote images, the path is the URL. For local, we prefer thumbnail cache or undefined.
    return typeof data.path === 'string' ? data.path : imageUrlCache.getThumb(data.id!, Math.round(width));
  });
  const containerRef = useRef<HTMLDivElement | null>(null);

  // Create a small thumbnail for local files only when the card becomes visible.
  useEffect(() => {
    if (typeof data.path === 'string') {
      // remote URL — we already returned it above
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
        <img src={imageUrl} alt={data.name} loading="lazy" decoding="async" style={{ width: '100%', height: '100%', display: 'block', objectFit: 'cover' }} />
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
  const serverOffsetsRef = useRef<Record<number, number>>({});
  const filterVersionRef = useRef(0);
  const isBatchLoadingRef = useRef(false);
  const pendingAnimationRef = useRef<number | null>(null);
  const BATCH_SIZE = 50;
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

  const loadMoreItems = useCallback(async () => {
    if (isBatchLoadingRef.current) return;
    if (!hasMoreRef.current) return;
    isBatchLoadingRef.current = true;
    const version = filterVersionRef.current;
    const limit = BATCH_SIZE;
    const incoming: Picture[] = [];
    let clientHasMore = false;
    let serverHasMore = false;
    let nextClientOffset = clientOffsetRef.current;
    const nextServerOffsets: Record<number, number> = { ...serverOffsetsRef.current };
    const trimmedSearch = searchTerm.trim();
    const searchTermLower = trimmedSearch.toLowerCase();

    try {
      if (selectedClientIds.length > 0) {
        let collection = db.pictures.where('sourceId').anyOf(selectedClientIds);
        if (searchTermLower) {
          collection = collection.filter(p => p.name.toLowerCase().includes(searchTermLower));
        }
        const sorted = await collection.sortBy('modified');
        sorted.reverse();
        const slice = sorted.slice(nextClientOffset, nextClientOffset + limit);
        clientHasMore = sorted.length > nextClientOffset + slice.length;
        nextClientOffset += slice.length;
        incoming.push(...slice);
      }

      if (selectedServerIds.length > 0) {
        const perServerLimit = Math.max(10, Math.ceil(limit / Math.max(1, selectedServerIds.length)));
        for (const serverId of selectedServerIds) {
          const source = serverSources.find(s => s.id === serverId);
          if (!source) continue;
          const offset = nextServerOffsets[serverId] || 0;
          const params = new URLSearchParams({
            offset: String(offset),
            limit: String(perServerLimit),
            sourceName: source.name,
          });
          if (trimmedSearch) params.set('searchTerm', trimmedSearch);
          try {
            const response = await fetch(`/api/server-pictures?${params.toString()}`);
            if (!response.ok) throw new Error(`Server responded ${response.status}`);
            const data = await response.json();
            const pictures = (data.pictures || []).map((pic: Picture) => ({ ...pic, sourceId: pic.sourceId ?? serverId }));
            if (pictures.length > 0) {
              incoming.push(...pictures);
              nextServerOffsets[serverId] = offset + pictures.length;
            }
            if (data.hasMore) serverHasMore = true;
          } catch (error) {
            console.error(`Failed to load server pictures for ${source.name}`, error);
          }
        }
      }
    } catch (error) {
      console.error('Failed to load pictures batch', error);
    }

    if (filterVersionRef.current !== version) {
      isBatchLoadingRef.current = false;
      return;
    }

    clientOffsetRef.current = nextClientOffset;
    serverOffsetsRef.current = nextServerOffsets;

    if (incoming.length === 0) {
      hasMoreRef.current = clientHasMore || serverHasMore;
      isBatchLoadingRef.current = false;
      if (hasMoreRef.current && pendingAnimationRef.current === null) {
        pendingAnimationRef.current = window.requestAnimationFrame(() => {
          pendingAnimationRef.current = null;
          void loadMoreItems();
        });
      }
      return;
    }

    incoming.sort((a, b) => b.modified - a.modified);

    const getKey = (p: Picture) => {
      if (p.relativePath) return `${p.sourceId}|${p.relativePath}`;
      if (typeof p.path === 'string') return `${p.sourceId}|${p.path}`;
      return `${p.sourceId}|${p.name}`;
    };
    const seen = new Set<string>();
    const allowedBatch: Picture[] = [];
    for (const p of incoming) {
      if (!shouldDisplayPicture(p)) {
        continue;
      }
      const k = getKey(p);
      if (!seen.has(k)) {
        seen.add(k);
        allowedBatch.push(p);
      }
    }

    if (filterVersionRef.current !== version) {
      isBatchLoadingRef.current = false;
      return;
    }

    if (allowedBatch.length === 0) {
      hasMoreRef.current = clientHasMore || serverHasMore;
      isBatchLoadingRef.current = false;
      if (hasMoreRef.current && pendingAnimationRef.current === null) {
        pendingAnimationRef.current = window.requestAnimationFrame(() => {
          pendingAnimationRef.current = null;
          void loadMoreItems();
        });
      }
      return;
    }

    setItems(currentItems => {
      if (filterVersionRef.current !== version) {
        return currentItems;
      }
      if (currentItems.length === 0) {
        return allowedBatch;
      }
      const existing = new Set<string>(currentItems.map(it => getKey(it)));
      const toAdd: Picture[] = [];
      for (const p of allowedBatch) {
        const k = getKey(p);
        if (!existing.has(k)) {
          existing.add(k);
          toAdd.push(p);
        }
      }
      return toAdd.length > 0 ? [...currentItems, ...toAdd] : currentItems;
    });

    hasMoreRef.current = clientHasMore || serverHasMore;
    isBatchLoadingRef.current = false;
  }, [BATCH_SIZE, searchTerm, selectedClientIds, selectedServerIds, serverSources, shouldDisplayPicture]);
  
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // Resize observer for container width
  useLayoutEffect(() => {
    if (containerRef.current) setContainerWidth(containerRef.current.clientWidth);
  }, []);
  useResizeObserver(containerRef, (entry) => {
    setContainerWidth(entry.contentRect.width);
  });

  // Helper: group key based on date (yyyy-mm-dd)
  function formatGroupKey(ms: number) {
    const d = new Date(ms);
    if (groupBy === 'month') {
      const y = d.getFullYear();
      const m = String(d.getMonth() + 1).padStart(2, '0');
      return `${y}-${m}`;
    }
    if (groupBy === 'week') {
      // ISO week number: simple approximate using UTC
      const tmp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
      const dayNum = tmp.getUTCDay() || 7;
      tmp.setUTCDate(tmp.getUTCDate() + 4 - dayNum);
      const yearStart = new Date(Date.UTC(tmp.getUTCFullYear(), 0, 1));
      const weekNo = Math.ceil((((tmp.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
      return `${tmp.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
    }
    // default day
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
  }

  // Build justified rows grouped by date whenever items or container width change
  useEffect(() => {
    if (!items || items.length === 0 || !containerWidth) {
      setRows([]);
      return;
    }

    const groupsMap = new Map<string, Picture[]>();
    // Maintain insertion order by iterating items
    for (const p of items) {
      const key = formatGroupKey(p.modified);
      const arr = groupsMap.get(key) || [];
      arr.push(p);
      groupsMap.set(key, arr);
    }

    const effectiveContainerWidth = Math.max(100, containerWidth) - 1; // avoid div by zero
    const groupAcc: Array<{ label: string; rows: Array<Array<{ item: Picture; width: number; height: number }>> }> = [];

  for (const pictures of groupsMap.values()) {
      // build rows for this group's pictures only
      const rowsForGroup: Array<Array<{ item: Picture; width: number; height: number }>> = [];
      let currentRow: Array<{ item: Picture; width: number; height: number }> = [];
      let currentRowWidth = 0;

      for (let i = 0; i < pictures.length; i++) {
        const p = pictures[i];
        const ratio = (p.width && p.height) ? (p.width / p.height) : (1.6);
        const w = ratio * ROW_HEIGHT;
        currentRow.push({ item: p, width: w, height: ROW_HEIGHT });
        currentRowWidth += w + GAP;

        if (currentRowWidth - GAP >= effectiveContainerWidth) {
          const totalWidth = currentRow.reduce((s, it) => s + it.width, 0);
          const gapsTotal = (currentRow.length - 1) * GAP;
          const scale = (effectiveContainerWidth - gapsTotal) / totalWidth;
          const finalHeight = Math.max(40, Math.round(ROW_HEIGHT * scale));
          const finalized = currentRow.map(it => ({ item: it.item, width: Math.round(it.width * scale), height: finalHeight }));
          rowsForGroup.push(finalized);
          currentRow = [];
          currentRowWidth = 0;
        }
      }

      if (currentRow.length > 0) {
        const totalWidth = currentRow.reduce((s, it) => s + it.width, 0);
        const gapsTotal = (currentRow.length - 1) * GAP;
        const scale = Math.min(1, (effectiveContainerWidth - gapsTotal) / totalWidth);
        const finalHeight = Math.max(40, Math.round(ROW_HEIGHT * scale));
        const finalized = currentRow.map(it => ({ item: it.item, width: Math.round(it.width * scale), height: finalHeight }));
        rowsForGroup.push(finalized);
      }

      // Create a human-friendly label for the group
      const label = new Date(pictures[0].modified).toLocaleDateString();
      groupAcc.push({ label, rows: rowsForGroup });
    }

    setRows(groupAcc);
  }, [items, containerWidth]);

  useEffect(() => {
    filterVersionRef.current += 1;
    if (pendingAnimationRef.current !== null) {
      cancelAnimationFrame(pendingAnimationRef.current);
      pendingAnimationRef.current = null;
    }
    isBatchLoadingRef.current = false;
    clientOffsetRef.current = 0;
    serverOffsetsRef.current = {};
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
  }, [selectedClientIds, selectedServerIds, searchTerm, loadMoreItems]);

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
    }, { root: null, rootMargin: '400px' });
    observer.observe(el);
    return () => observer.disconnect();
  }, [items.length, loadMoreItems]);

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