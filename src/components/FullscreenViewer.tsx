import { useState, useEffect, useCallback, useRef } from 'react';
import Dialog from '@mui/material/Dialog';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import ZoomInMapIcon from '@mui/icons-material/ZoomInMap';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Picture } from '../db/db';

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;


function PictureDetails({ picture }: { picture: Picture }) {
  const source = useLiveQuery(() => db.dataSources.get(picture.sourceId), [picture.sourceId]);
  return (
    <Paper sx={{ p: 2, mt: 2, bgcolor: 'rgba(0, 0, 0, 0.5)', color: 'common.white' }}>
      <Typography variant="h6" sx={{ wordBreak: 'break-all', color: 'common.white' }}>{picture.name}</Typography>
      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.85)' }}>Source: {source?.name}</Typography>
      <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)' }}>Date: {new Date(picture.modified).toLocaleString()}</Typography>
      {picture.size && <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)' }}>Size: {(picture.size / 1024 / 1024).toFixed(2)} MB</Typography>}
      {(picture.width && picture.height) && <Typography variant="body2" sx={{ color: 'rgba(255,255,255,0.75)' }}>Dimensions: {picture.width} x {picture.height}</Typography>}
    </Paper>
  );
}

interface FullscreenViewerProps {
  open: boolean;
  onClose: () => void;
  picture: Picture | null;
  onNavigate: (direction: 'prev' | 'next') => void;
}

export default function FullscreenViewer({ open, onClose, picture, onNavigate }: FullscreenViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);

  // States for zoom and pan
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);

  const handleReset = useCallback(() => {
    setScale(1);
    setPosition({ x: 0, y: 0 });
  }, []);

  // --- Robust Wheel Handler using the "useEvent" pattern ---
  const savedWheelCallback = useRef((_: WheelEvent) => {});

  useEffect(() => {
    // Keep the ref updated with the latest handler
    savedWheelCallback.current = (e: WheelEvent) => {
      e.preventDefault();
      const delta = e.deltaY * -0.005;
      // Use functional update to always get the latest scale
      setScale(prevScale => {
        const newScale = Math.min(Math.max(prevScale + delta, MIN_SCALE), MAX_SCALE);
        return newScale;
      });
    };
  });

  useEffect(() => {
    const container = imageContainerRef.current;
    if (open && container) {
      const eventListener = (e: WheelEvent) => savedWheelCallback.current(e);
      container.addEventListener('wheel', eventListener, { passive: false });
      return () => {
        container.removeEventListener('wheel', eventListener);
      };
    }
  }, [open, imageContainerRef.current]); // Depend on 'open' and the ref's current value
  // --- End of Wheel Handler ---

  const handleMouseDown = (e: React.MouseEvent) => {
    if (e.button !== 0 || scale === 1) return; // Only main mouse button, and only allow drag when zoomed
    e.preventDefault();
    setIsDragging(true);
    setDragStart({ x: e.clientX - position.x, y: e.clientY - position.y });
  };

  const handleMouseMove = (e: React.MouseEvent) => {
    if (!isDragging) return;
    e.preventDefault();
    setPosition({
      x: e.clientX - dragStart.x,
      y: e.clientY - dragStart.y,
    });
  };

  const handleMouseUp = () => {
    setIsDragging(false);
  };
  
  const handleDoubleClick = () => {
    if (scale > 1) {
      handleReset();
    } else {
      // Zoom to a fixed intermediate scale
      setScale(2.5);
    }
  };

  const handleNavigation = useCallback((direction: 'prev' | 'next') => {
    if (!picture) return;
    onNavigate(direction);
  }, [picture, onNavigate]);

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'ArrowLeft' || event.key === 'ArrowUp') {
        handleNavigation('prev');
      } else if (event.key === 'ArrowRight' || event.key === 'ArrowDown') {
        handleNavigation('next');
      } else if (event.key === 'Escape') {
        onClose();
      }
    };

    if (open) {
      window.addEventListener('keydown', handleKeyDown);
    }

    return () => {
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, handleNavigation, onClose]);

  useEffect(() => {
    let isMounted = true;
    let objectUrl: string | null = null;

    const createUrl = async () => {
      if (!picture) return;

      // Reset zoom/pan state when picture changes
      handleReset(); 
      setImageUrl(null);

      if (typeof picture.path === 'string') {
        // It's a remote URL
        if (isMounted) setImageUrl(picture.path);
      } else {
        // It's a local FileSystemFileHandle
        try {
          const fileHandle = picture.path as unknown as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          objectUrl = URL.createObjectURL(file);
          if (isMounted) setImageUrl(objectUrl);
        } catch (error) { console.error('Failed to create object URL for viewer:', error); }
      }
    };

    createUrl();

    return () => {
      isMounted = false;
      if (objectUrl) {
        URL.revokeObjectURL(objectUrl);
      }
    };
  }, [picture, handleReset]);

  useEffect(() => {
    // When the image URL is set, focus the container to enable wheel events immediately.
    if (imageUrl && imageContainerRef.current) {
      imageContainerRef.current.focus();
    }
  }, [imageUrl]);

  return (
    <Dialog fullScreen open={open} onClose={onClose} PaperProps={{ sx: { bgcolor: 'transparent' } }}>
      <AppBar sx={{ position: 'relative', background: 'rgba(0,0,0,0.5)' }}>
          <Toolbar>
            <Typography sx={{ ml: 2, flex: 1, color: 'common.white' }} variant="h6" component="div">{picture?.name || 'Image Viewer'}</Typography>
          <IconButton color="inherit" onClick={handleReset} aria-label="reset zoom"><ZoomInMapIcon /></IconButton>
          <IconButton edge="end" color="inherit" onClick={onClose} aria-label="close"><CloseIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ display: 'flex', height: 'calc(100% - 64px)', bgcolor: 'rgba(0,0,0,0.8)' }}>
        <IconButton onClick={() => handleNavigation('prev')} sx={{ color: 'white', my: 'auto', zIndex: 1 }}><ArrowBackIosNewIcon fontSize="large" /></IconButton>
        <Box 
          ref={imageContainerRef}
          tabIndex={-1} // Make the container focusable
          sx={{ 
            flex: 1, 
            display: 'flex', 
            alignItems: 'center', 
            justifyContent: 'center', 
            p: 1, 
            overflow: 'hidden', 
            outline: 'none', // Remove the focus outline
            cursor: isDragging ? 'grabbing' : (scale > 1 ? 'grab' : 'default')
          }}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp} // End drag if mouse leaves the area
        >
          {imageUrl ? (
            <img 
              ref={imageRef}
              src={imageUrl} 
              alt={picture?.name} 
              style={{ 
                maxHeight: '100%', 
                maxWidth: '100%', 
                objectFit: 'contain',
                transform: `scale(${scale}) translate(${position.x}px, ${position.y}px)`,
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                cursor: 'inherit'
              }}
              onDoubleClick={handleDoubleClick}
            />
          ) : <Typography>Loading...</Typography>}
        </Box>
        <IconButton onClick={() => handleNavigation('next')} sx={{ color: 'white', my: 'auto', zIndex: 1 }}><ArrowForwardIosIcon fontSize="large" /></IconButton>
        <Box sx={{ width: '320px', p: 2, overflowY: 'auto', position: 'absolute', right: 0, top: '64px', height: 'calc(100% - 64px)' }}>
          {picture && <PictureDetails picture={picture} />}
        </Box>
      </Box>
    </Dialog>
  );
}