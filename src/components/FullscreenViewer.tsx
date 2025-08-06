import { useState, useEffect, useCallback } from 'react';
import Dialog from '@mui/material/Dialog';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import IconButton from '@mui/material/IconButton';
import Typography from '@mui/material/Typography';
import CloseIcon from '@mui/icons-material/Close';
import ArrowBackIosNewIcon from '@mui/icons-material/ArrowBackIosNew';
import ArrowForwardIosIcon from '@mui/icons-material/ArrowForwardIos';
import Box from '@mui/material/Box';
import Paper from '@mui/material/Paper';
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Picture } from '../db/db';

function PictureDetails({ picture }: { picture: Picture }) {
  const source = useLiveQuery(() => db.dataSources.get(picture.sourceId), [picture.sourceId]);
  return (
    <Paper sx={{ p: 2, mt: 2, bgcolor: 'rgba(0, 0, 0, 0.3)' }}>
      <Typography variant="h6" sx={{ wordBreak: 'break-all' }}>{picture.name}</Typography>
      <Typography variant="body2" color="text.secondary">Source: {source?.name}</Typography>
      <Typography variant="body2" color="text.secondary">Date: {new Date(picture.modified).toLocaleString()}</Typography>
      {picture.size && <Typography variant="body2" color="text.secondary">Size: {(picture.size / 1024 / 1024).toFixed(2)} MB</Typography>}
      {(picture.width && picture.height) && <Typography variant="body2" color="text.secondary">Dimensions: {picture.width} x {picture.height}</Typography>}
    </Paper>
  );
}

export default function FullscreenViewer({ open, onClose, pictureId, pictureIds, onNavigate }: any) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const picture = useLiveQuery(() => pictureId ? db.pictures.get(pictureId) : undefined, [pictureId]);

  const handleNavigation = useCallback((direction: 'prev' | 'next') => {
    if (!pictureId) return;
    const currentIndex = pictureIds.indexOf(pictureId);
    let nextIndex;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % pictureIds.length;
    } else {
      nextIndex = (currentIndex - 1 + pictureIds.length) % pictureIds.length;
    }
    onNavigate(pictureIds[nextIndex]);
  }, [pictureId, pictureIds, onNavigate]);

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
    const createUrl = async () => {
      if (picture?.path) {
        setImageUrl(null);
        try {
          const fileHandle = picture.path as unknown as FileSystemFileHandle;
          const file = await fileHandle.getFile();
          if (isMounted) setImageUrl(URL.createObjectURL(file));
        } catch (error) { console.error('Failed to create object URL for viewer:', error); }
      }
    };
    createUrl();
    return () => {
      isMounted = false;
      if (imageUrl) URL.revokeObjectURL(imageUrl);
    };
  }, [picture]);

  return (
    <Dialog fullScreen open={open} onClose={onClose} PaperProps={{ sx: { bgcolor: 'transparent' } }}>
      <AppBar sx={{ position: 'relative', background: 'rgba(0,0,0,0.5)' }}>
        <Toolbar>
          <Typography sx={{ ml: 2, flex: 1 }} variant="h6" component="div">{picture?.name || 'Image Viewer'}</Typography>
          <IconButton edge="end" color="inherit" onClick={onClose} aria-label="close"><CloseIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Box sx={{ display: 'flex', height: 'calc(100% - 64px)', bgcolor: 'rgba(0,0,0,0.8)' }}>
        <IconButton onClick={() => handleNavigation('prev')} sx={{ color: 'white', my: 'auto', zIndex: 1 }}><ArrowBackIosNewIcon fontSize="large" /></IconButton>
        <Box sx={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', p: 1, overflow: 'hidden' }}>
          {imageUrl ? <img src={imageUrl} alt={picture?.name} style={{ maxHeight: '100%', maxWidth: '100%', objectFit: 'contain' }} /> : <Typography>Loading...</Typography>}
        </Box>
        <IconButton onClick={() => handleNavigation('next')} sx={{ color: 'white', my: 'auto', zIndex: 1 }}><ArrowForwardIosIcon fontSize="large" /></IconButton>
        <Box sx={{ width: '320px', p: 2, overflowY: 'auto', position: 'absolute', right: 0, top: '64px', height: 'calc(100% - 64px)' }}>
          {picture && <PictureDetails picture={picture} />}
        </Box>
      </Box>
    </Dialog>
  );
}