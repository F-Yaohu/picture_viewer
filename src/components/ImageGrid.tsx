import { useState, useEffect, useCallback, useRef } from 'react';
import { Masonry, useInfiniteLoader } from 'masonic';
import ImageListItemBar from '@mui/material/ImageListItemBar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { db, type Picture, type DataSource } from '../db/db';
import { imageUrlCache } from '../utils/imageUrlCache';

const PictureCard = ({ data, width }: { data: Picture, width: number }) => {
  const [imageUrl, setImageUrl] = useState<string | undefined>(() => {
    // For remote images, the path is the URL. For local, we check the cache.
    return typeof data.path === 'string' ? data.path : imageUrlCache.get(data.id!);
  });

  // The aspect ratio is now known beforehand, so we can calculate the height synchronously.
  const aspectRatio = (data.height && data.width) ? data.height / data.width : 1.25; // Fallback aspect ratio
  const height = width * aspectRatio;

  useEffect(() => {
    let isMounted = true;
    // Only create an Object URL for local files (if not already cached and not a remote URL)
    if (!imageUrl && typeof data.path !== 'string') {
      const createUrl = async () => {
        if (data.path) {
          try {
            const fileHandle = data.path as unknown as FileSystemFileHandle;
            const file = await fileHandle.getFile();
            const newUrl = URL.createObjectURL(file);
            if (isMounted) {
              imageUrlCache.set(data.id!, newUrl);
              setImageUrl(newUrl);
            }
          } catch (error) { console.error('Failed to create object URL:', error); }
        }
      };
      createUrl();
    }
    return () => { isMounted = false; };
  }, [data.id, data.path, imageUrl]); // Depend on data.id and data.path


  if (!imageUrl) {
    // Render a placeholder with the correct, pre-calculated height.
    return <div style={{ height, backgroundColor: '#333', borderRadius: '4px' }} />;
  }

  return (
    <Box sx={{ position: 'relative', cursor: 'pointer', borderRadius: 1, overflow: 'hidden' }}>
      <img src={imageUrl} alt={data.name} loading="lazy" style={{ width: '100%', height: '100%', display: 'block' }} />
      <ImageListItemBar
        sx={{ background: 'linear-gradient(to top, rgba(0,0,0,0.7) 0%, rgba(0,0,0,0.3) 70%, rgba(0,0,0,0) 100%)' }}
        title={data.name}
        subtitle={<span>{new Date(data.modified).toLocaleDateString()}</span>}
      />
    </Box>
  );
};

interface ImageGridProps {
  filterSourceId: number | 'all';
  searchTerm: string;
  serverSources: DataSource[];
  onPictureClick: (picture: Picture) => void;
  onPicturesLoaded: (pictures: Picture[]) => void;
}

export default function ImageGrid({ filterSourceId, searchTerm, serverSources, onPictureClick, onPicturesLoaded }: ImageGridProps) {
  const [items, setItems] = useState<Picture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasMoreRef = useRef(true);
  const BATCH_SIZE = 50; // Load 50 items at a time

  const isServerSource = (sourceId: number | 'all') => {
    if (sourceId === 'all') return false; // 'all' is not a server source itself
    return serverSources.some(s => s.id === sourceId);
  };

  const loadMoreItems = useCallback(async (startIndex: number) => {
    if (!hasMoreRef.current && startIndex > 0) return;

    let newItems: Picture[] = [];
    let hasMore = true;

    const offset = startIndex;
    const limit = BATCH_SIZE;

    if (isServerSource(filterSourceId)) {
      // --- Case 1: Fetching from a specific server source ---
      const source = serverSources.find(s => s.id === filterSourceId);
      const response = await fetch(`/api/server-pictures?sourceName=${encodeURIComponent(source!.name)}&offset=${offset}&limit=${limit}&searchTerm=${encodeURIComponent(searchTerm)}`);
      const data = await response.json();
      newItems = data.pictures || [];
      hasMore = data.hasMore;

    } else {
      // --- Case 2: Fetching from Dexie (client-side sources or 'all') ---
      let collection = db.pictures.toCollection();
      if (filterSourceId !== 'all') {
        collection = collection.filter(p => p.sourceId === filterSourceId);
      }
      if (searchTerm) {
        collection = collection.filter(p => p.name.toLowerCase().includes(searchTerm.toLowerCase()));
      }
      
      const clientItems = await collection
        .sortBy('modified')
        .then(sorted => sorted.reverse())
        .then(reversed => reversed.slice(offset, offset + limit));

      // --- For 'all' view, also fetch from server ---
      if (filterSourceId === 'all') {
        const response = await fetch(`/api/server-pictures?offset=${offset}&limit=${limit}&searchTerm=${encodeURIComponent(searchTerm)}`);
        const serverData = await response.json();
        const serverItems = serverData.pictures || [];
        
        // Combine and re-sort
        const combined = [...clientItems, ...serverItems];
        combined.sort((a, b) => b.modified - a.modified);
        newItems = combined.slice(0, limit); // Ensure we don't exceed the batch size

        // If either has more, we assume there are more items overall
        hasMore = (clientItems.length === limit) || serverData.hasMore;

      } else {
        newItems = clientItems;
        hasMore = newItems.length === limit;
      }
    }

    hasMoreRef.current = hasMore;

    if (startIndex === 0) {
      setItems(newItems);
    } else {
      setItems(currentItems => [...currentItems, ...newItems]);
    }
  }, [filterSourceId, searchTerm, serverSources]);
  
  const loader = useInfiniteLoader(loadMoreItems, {
    isItemLoaded: (index, items) => !!items[index],
    minimumBatchSize: BATCH_SIZE,
    threshold: 3,
  });

  useEffect(() => {
    // Reset everything when the filter or search term changes
    setItems([]);
    hasMoreRef.current = true;
    setIsLoading(true);
    loadMoreItems(0).finally(() => {
      setIsLoading(false);
    });
  }, [filterSourceId, searchTerm, serverSources, loadMoreItems]); // Rerun when filter/search/server data changes

  useEffect(() => {
    onPicturesLoaded(items);
  }, [items, onPicturesLoaded]);


  if (isLoading) {
    return <Typography>Loading...</Typography>;
  }

  if (items.length === 0 && !hasMoreRef.current) {
    return <Typography>No pictures found. Add or enable a data source and click Refresh.</Typography>;
  }

  return (
    <Masonry
      items={items}
      columnGutter={12}
      columnWidth={236}
      overscanBy={5}
      onRender={loader}
      render={({ data, width }) => (
        <div onClick={() => onPictureClick(data)}>
          <PictureCard data={data} width={width} />
        </div>
      )}
    />
  );
}