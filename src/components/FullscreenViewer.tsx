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
import InfoIcon from '@mui/icons-material/Info';
import Box from '@mui/material/Box';
import VisibilityIcon from '@mui/icons-material/Visibility';
import VisibilityOffIcon from '@mui/icons-material/VisibilityOff';
import Paper from '@mui/material/Paper';
// Drawer replaced by inline Paper panel; keep Paper import above
import { useLiveQuery } from 'dexie-react-hooks';
import { db, type Picture } from '../db/db';

const MIN_SCALE = 0.5;
const MAX_SCALE = 5;




interface FullscreenViewerProps {
  open: boolean;
  onClose: () => void;
  picture: Picture | null;
  onNavigate: (direction: 'prev' | 'next') => void;
}

export default function FullscreenViewer({ open, onClose, picture, onNavigate }: FullscreenViewerProps) {
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [detailsOpen, setDetailsOpen] = useState(false);

  // States for zoom and pan
  const [scale, setScale] = useState(1);
  const [position, setPosition] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const [dragStart, setDragStart] = useState({ x: 0, y: 0 });
  const imageContainerRef = useRef<HTMLDivElement>(null);
  const imageRef = useRef<HTMLImageElement>(null);
  const infoButtonRef = useRef<HTMLButtonElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const [panelStyle, setPanelStyle] = useState<{ top: number; left: number } | null>(null);

  // compute and update the panel position so it appears under the Info button
  useEffect(() => {
    const compute = () => {
      if (!detailsOpen || !infoButtonRef.current) {
        setPanelStyle(null);
        return;
      }
      const rect = infoButtonRef.current.getBoundingClientRect();
      const panelWidth = 280;
      const margin = 8;
      let left = rect.left + rect.width / 2 - panelWidth / 2;
      if (left < margin) left = margin;
      if (left + panelWidth > window.innerWidth - margin) left = window.innerWidth - panelWidth - margin;
      const top = rect.bottom + 6;
      setPanelStyle({ top, left });
    };

    compute();
    window.addEventListener('resize', compute);
    window.addEventListener('scroll', compute, true);
    return () => {
      window.removeEventListener('resize', compute);
      window.removeEventListener('scroll', compute, true);
    };
  }, [detailsOpen, picture]);

  // close the panel when clicking outside the button or the panel
  useEffect(() => {
    const onDocDown = (e: MouseEvent) => {
      if (!detailsOpen) return;
      const target = e.target as Node | null;
      if (!target) return;
      if (panelRef.current && panelRef.current.contains(target)) return;
      if (infoButtonRef.current && infoButtonRef.current.contains(target)) return;
      setDetailsOpen(false);
    };
    document.addEventListener('mousedown', onDocDown);
    return () => document.removeEventListener('mousedown', onDocDown);
  }, [detailsOpen]);

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

  // Fetch source info for the current picture for compact info display
  const source = useLiveQuery(() => (picture ? db.dataSources.get(picture.sourceId) : undefined), [picture?.sourceId]);

  // Privacy setting: hide GPS (stored in settings table)
  const hideGPSEntry = useLiveQuery(() => db.settings.get('hideGPS'), []);
  const hideGPS = !!hideGPSEntry?.value;

  const setHideGPS = async (v: boolean) => {
    try {
      await db.settings.put({ key: 'hideGPS', value: v });
    } catch (e) {
      console.warn('Failed to update hideGPS setting', e);
    }
  };

  // EXIF data state (viewer relies only on DB-stored EXIF; no on-demand parsing)
  const [exifData, setExifData] = useState<any | null>(null);

  useEffect(() => {
    if (!picture) {
      setExifData(null);
      return;
    }
    // Use DB-stored exifRaw (scan worker should populate exifRaw for local files)
    setExifData((picture as any).exifRaw || null);
  }, [picture]);

  // Normalize GPS values for display (avoid NaN)
  const computeGPS = () => {
    // Prefer DB-stored numeric GPS fields (scan worker writes exifGPSLat/exifGPSLon)
    if (picture && typeof (picture as any).exifGPSLat === 'number' && typeof (picture as any).exifGPSLon === 'number') {
      return { lat: (picture as any).exifGPSLat as number, lon: (picture as any).exifGPSLon as number };
    }
    if (!exifData) return { lat: undefined as number|undefined, lon: undefined as number|undefined };
    const toDecimal = (v: any) => {
      if (v == null) return undefined;
      if (typeof v === 'number') return v;
      if (Array.isArray(v)) {
        const [deg, min, sec] = v.map((n: any) => Number(n || 0));
        if (Number.isFinite(deg)) return deg + (min || 0) / 60 + (sec || 0) / 3600;
        return undefined;
      }
      const parsed = Number(v);
      return Number.isFinite(parsed) ? parsed : undefined;
    };

    let lat = undefined as number | undefined;
    let lon = undefined as number | undefined;

    if (typeof exifData.latitude === 'number' && typeof exifData.longitude === 'number') {
      lat = exifData.latitude;
      lon = exifData.longitude;
    } else {
      lat = toDecimal(exifData.GPSLatitude ?? exifData.gpsLatitude ?? exifData.lat ?? exifData.gps?.latitude);
      lon = toDecimal(exifData.GPSLongitude ?? exifData.gpsLongitude ?? exifData.lon ?? exifData.gps?.longitude);
      // apply refs if present
      const latRef = exifData.GPSLatitudeRef || exifData.gpsLatitudeRef || exifData.latRef || exifData.LatitudeRef;
      const lonRef = exifData.GPSLongitudeRef || exifData.gpsLongitudeRef || exifData.lonRef || exifData.LongitudeRef;
      if (lat != null && typeof latRef === 'string' && latRef.toUpperCase() === 'S') lat = -Math.abs(lat);
      if (lon != null && typeof lonRef === 'string' && lonRef.toUpperCase() === 'W') lon = -Math.abs(lon);
    }

    return { lat, lon };
  };

  const { lat: gpsLat, lon: gpsLon } = computeGPS();

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
    <Dialog fullScreen open={open} onClose={onClose} PaperProps={{ sx: { bgcolor: 'transparent', borderRadius: 0 } }}>
  <AppBar sx={{
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    borderRadius: 0,
    height: '92px',
    // Softer, smoother gradient with multiple stops for less abrupt transition
    background: 'linear-gradient(to bottom, rgba(0,0,0,0.55) 0%, rgba(0,0,0,0.26) 30%, rgba(0,0,0,0.08) 60%, rgba(0,0,0,0) 100%)',
    zIndex: 1500,
    // reduce blur to make the gradient crisper but still provide slight backdrop separation
    backdropFilter: 'blur(1px)'
  }}>
        <Toolbar sx={{ position: 'relative', minHeight: 88, alignItems: 'center' }}>
          <Typography
            sx={{ ml: 2, flex: 1, color: 'common.white', fontSize: '0.95rem', maxWidth: '40ch', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', pr: '180px' }}
            variant="h6"
            component="div"
            title={picture?.name}
          >
            {picture?.name || 'Image Viewer'}
          </Typography>

          <Box sx={{ position: 'absolute', right: 8, top: 0, height: '100%', display: 'flex', alignItems: 'center', gap: 1 }}>
            <IconButton ref={(el: HTMLButtonElement | null) => { infoButtonRef.current = el }} sx={{ color: 'rgba(255,255,255,0.95)' }} onClick={() => setDetailsOpen(prev => !prev)} aria-label="toggle details">
              <InfoIcon />
            </IconButton>
            <IconButton sx={{ color: 'rgba(255,255,255,0.95)' }} onClick={handleReset} aria-label="reset zoom"><ZoomInMapIcon /></IconButton>
            <IconButton edge="end" sx={{ color: 'rgba(255,255,255,0.95)' }} onClick={onClose} aria-label="close"><CloseIcon /></IconButton>
          </Box>
        </Toolbar>
      </AppBar>
  <Box sx={{ display: 'flex', height: '100%', bgcolor: 'rgba(0,0,0,0.8)', position: 'relative', overflow: 'hidden' }}>
    <IconButton onClick={() => handleNavigation('prev')} sx={{ color: 'white', my: 'auto', zIndex: 1400 }}><ArrowBackIosNewIcon fontSize="large" /></IconButton>
        <Box 
          ref={imageContainerRef}
          tabIndex={-1} // Make the container focusable
          sx={{ 
            flex: 1, 
            display: 'block',
            p: 1,
            outline: 'none', // Remove the focus outline
            cursor: isDragging ? 'grabbing' : (scale > 1 ? 'grab' : 'default'),
            position: 'relative'
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
              onDoubleClick={handleDoubleClick}
              style={{
                position: 'absolute',
                top: '50%',
                left: '50%',
                transform: `translate(-50%, -50%) translate(${position.x}px, ${position.y}px) scale(${scale})`,
                transformOrigin: 'center center',
                maxWidth: '100%',
                maxHeight: '100%',
                width: 'auto',
                height: 'auto',
                display: 'block',
                transition: isDragging ? 'none' : 'transform 0.1s ease-out',
                willChange: 'transform',
                cursor: 'inherit'
              }}
            />
          ) : <Typography>Loading...</Typography>}
        </Box>
  <IconButton onClick={() => handleNavigation('next')} sx={{ color: 'white', my: 'auto', zIndex: 1400 }}><ArrowForwardIosIcon fontSize="large" /></IconButton>
        {/* Compact centered info card (shows only key info in the middle) */}
        {detailsOpen && picture && (
          <Paper
            ref={(el: HTMLDivElement | null) => { panelRef.current = el }}
            sx={{
              position: 'absolute',
              zIndex: 1600,
              width: 280,
              maxWidth: '80vw',
              bgcolor: 'rgba(0,0,0,0.6)',
              color: 'common.white',
              p: 1.5,
              boxShadow: 3,
              borderRadius: 1,
            }}
            role="dialog"
            aria-label="picture details"
            style={panelStyle ? { top: `${panelStyle.top}px`, left: `${panelStyle.left}px` } : { display: 'none' }}
          >
            <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 0.5 }}>
              <Typography variant="subtitle2" sx={{ color: 'common.white', fontWeight: 600, maxWidth: '26ch', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={picture.name}>
                {picture.name}
              </Typography>
            </Box>

            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.9)', display: 'block' }}>来源: {source?.name || '—'}</Typography>
            <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', display: 'block' }}>日期: {new Date(picture.modified).toLocaleString()}</Typography>
            {(picture.width && picture.height) && <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', display: 'block' }}>尺寸: {picture.width} × {picture.height}</Typography>}
            {picture.size && <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.8)', display: 'block' }}>文件大小: {(picture.size / 1024 / 1024).toFixed(2)} MB</Typography>}
            {/* EXIF fields (if available) */}
            {/* EXIF fields (分组显示，增加行间距以避免混乱) */}
            {exifData ? (
              <>
                {/* 基本相机信息 */}
                {(exifData.Make || exifData.Model) && (
                  <Box sx={{ mt: 1 }}>
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', display: 'block' }}>相机: {exifData.Make || ''} {exifData.Model || ''}</Typography>
                  </Box>
                )}

                {/* 拍摄参数 */}
                <Box sx={{ mt: 1 }}>
                  {exifData.CreateDate && (
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', display: 'block' }}>拍摄时间: {new Date(exifData.CreateDate).toLocaleString()}</Typography>
                  )}
                  {exifData.ISO && (
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', display: 'block' }}>ISO: {exifData.ISO}</Typography>
                  )}
                  {exifData.FNumber && (
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', display: 'block' }}>光圈: f/{exifData.FNumber}</Typography>
                  )}
                  {exifData.ExposureTime && (
                    <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', display: 'block' }}>快门: {String(exifData.ExposureTime)}</Typography>
                  )}
                </Box>

                {/* GPS 单独一块 */}
                { (gpsLat != null && gpsLon != null) ? (
                  <Box sx={{ mt: 1 }}>
                    <Box sx={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', display: 'block' }}>位置 (GPS)</Typography>
                      <IconButton onClick={() => setHideGPS(!hideGPS)} sx={{ color: 'rgba(255,255,255,0.9)', p: 0.5 }} aria-label={hideGPS ? '显示位置' : '隐藏位置'}>
                        {hideGPS ? <VisibilityOffIcon fontSize="small" /> : <VisibilityIcon fontSize="small" />}
                      </IconButton>
                    </Box>
                    {!hideGPS ? (
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.85)', display: 'block' }}>{gpsLat.toFixed(6)}, {gpsLon.toFixed(6)}</Typography>
                    ) : (
                      <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', display: 'block' }}>位置已隐藏（敏感信息）</Typography>
                    )}
                  </Box>
                ) : null}
              </>
            ) : (
              <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.6)', display: 'block', mt: 1 }}>EXIF: 不可用</Typography>
            )}
            {typeof picture.path === 'string' && (() => {
              // If the path is a server-local path like '/server-images/..', show a full absolute URL
              const raw = picture.path as string;
              const display = (typeof window !== 'undefined' && raw && raw.startsWith('/')) ? `${window.location.origin}${raw}` : raw;
              return (
                <Typography variant="caption" sx={{ color: 'rgba(255,255,255,0.7)', mt: 0.5, wordBreak: 'break-all' }}>{display}</Typography>
              );
            })()}
          </Paper>
        )}
      </Box>
    </Dialog>
  );
}