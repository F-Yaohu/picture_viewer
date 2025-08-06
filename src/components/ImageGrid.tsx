import { useState, useEffect } from 'react';
import { Masonry } from 'masonic';
import ImageListItemBar from '@mui/material/ImageListItemBar';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Picture } from '../db/db';
import { imageUrlCache } from '../utils/imageUrlCache';

const PictureCard = ({ data, width }: { data: Picture, width: number }) => {
  const [imageUrl, setImageUrl] = useState<string | undefined>(() => imageUrlCache.get(data.id!));

  useEffect(() => {
    let isMounted = true;
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
  }, [data, imageUrl]);

  const aspectRatio = data.height && data.width ? data.height / data.width : 1.25;
  const height = width * aspectRatio;

  if (!imageUrl) {
    return <div style={{ height, backgroundColor: '#333' }} />;
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
  onPictureClick: (id: number) => void;
  onPicturesLoaded: (ids: number[]) => void;
}

export default function ImageGrid({ onPictureClick, onPicturesLoaded }: ImageGridProps) {
  const pictures = useLiveQuery(
    async () => {
      const pics = await db.pictures.toArray();
      pics.sort((a, b) => {
        if (a.modified !== b.modified) return b.modified - a.modified;
        return a.name.localeCompare(b.name);
      });
      return pics;
    },
    []
  );

  useEffect(() => {
    if (pictures) {
      onPicturesLoaded(pictures.map(p => p.id!));
    }
  }, [pictures, onPicturesLoaded]);

  if (!pictures) {
    return <Typography>Loading...</Typography>;
  }
  
  if (pictures.length === 0) {
    return <Typography>No pictures found. Add or enable a data source and click Refresh.</Typography>;
  }

  return (
    <Masonry
      items={pictures}
      columnGutter={12}
      columnWidth={236}
      overscanBy={5}
      render={({ data, width }) => (
        <div onClick={() => onPictureClick(data.id!)}>
          <PictureCard data={data} width={width} />
        </div>
      )}
    />
  );
}