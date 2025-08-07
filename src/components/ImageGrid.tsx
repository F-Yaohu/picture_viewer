import { useState, useEffect, useCallback, useRef } from 'react';
import { Masonry, useInfiniteLoader } from 'masonic';
import ImageListItemBar from '@mui/material/ImageListItemBar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import Dexie from 'dexie';
import { db, type Picture } from '../db/db';
import { imageUrlCache } from '../utils/imageUrlCache';

const PictureCard = ({ data, width }: { data: Picture, width: number }) => {
  const [imageUrl, setImageUrl] = useState<string | undefined>(() => imageUrlCache.get(data.id!));

  // The aspect ratio is now known beforehand, so we can calculate the height synchronously.
  const aspectRatio = (data.height && data.width) ? data.height / data.width : 1.25; // Fallback aspect ratio
  const height = width * aspectRatio;

  useEffect(() => {
    let isMounted = true;
    // Only create a new URL if it's not already cached.
    if (!imageUrl) {
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
  onPictureClick: (id: number) => void;
  onPicturesLoaded: (ids: number[]) => void;
}

export default function ImageGrid({ filterSourceId, onPictureClick, onPicturesLoaded }: ImageGridProps) {
  const [items, setItems] = useState<Picture[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const hasMoreRef = useRef(true);
  const BATCH_SIZE = 50; // Load 50 items at a time


  const loadMoreItems = useCallback(async (startIndex: number, stopIndex: number) => {
    if (!hasMoreRef.current) return;

    let query;
    if (filterSourceId === 'all') {
      query = db.pictures.orderBy('modified').reverse();
    } else {
      // Use the new compound index for efficient filtering and sorting
      query = db.pictures.where('[sourceId+modified]')
        .between([filterSourceId, Dexie.minKey], [filterSourceId, Dexie.maxKey])
        .reverse();
    }

    const newItems = await query
      .offset(startIndex)
      .limit(BATCH_SIZE)
      .toArray();

    if (newItems.length < BATCH_SIZE) {
      hasMoreRef.current = false;
    }

    setItems(currentItems => [...currentItems, ...newItems]);
  }, [filterSourceId]); // Recreate the loader when the filter changes
  
  const loader = useInfiniteLoader(loadMoreItems, {
    isItemLoaded: (index, items) => !!items[index],
    minimumBatchSize: BATCH_SIZE,
    threshold: 3,
  });

  useEffect(() => {
    // Reset everything when the filter changes
    setItems([]);
    hasMoreRef.current = true;
    setIsLoading(true);
    loadMoreItems(0, BATCH_SIZE).finally(() => {
      setIsLoading(false);
    });
  }, [filterSourceId, loadMoreItems]); // Rerun when filter changes

  useEffect(() => {
    onPicturesLoaded(items.map(p => p.id!));
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
        <div onClick={() => onPictureClick(data.id!)}>
          <PictureCard data={data} width={width} />
        </div>
      )}
    />
  );
}