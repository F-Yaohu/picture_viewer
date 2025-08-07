import { useState, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { ThemeProvider, styled, alpha } from '@mui/material/styles';
import CssBaseline from '@mui/material/CssBaseline';
import AppBar from '@mui/material/AppBar';
import Toolbar from '@mui/material/Toolbar';
import Typography from '@mui/material/Typography';
import Container from '@mui/material/Container';
import IconButton from '@mui/material/IconButton';
import SettingsIcon from '@mui/icons-material/Settings';
import RefreshIcon from '@mui/icons-material/Refresh';
import SearchIcon from '@mui/icons-material/Search';
import InputBase from '@mui/material/InputBase';
import Box from '@mui/material/Box';
import Modal from '@mui/material/Modal';
import LinearProgress from '@mui/material/LinearProgress';
import { useTranslation } from 'react-i18next';
import { useLiveQuery } from 'dexie-react-hooks';
import theme from './theme';
import SettingsDialog from './components/SettingsDialog';
import ImageGrid from './components/ImageGrid';
import FullscreenViewer from './components/FullscreenViewer';
import PermissionManager from './components/PermissionManager';
import { ErrorBoundary } from './components/ErrorBoundary'; // Import the ErrorBoundary
import FilterChips from './components/FilterChips';
import { db, type DataSource } from './db/db';
import { imageUrlCache } from './utils/imageUrlCache';
import { setSources } from './store/slices/dataSourceSlice';
import type { AppDispatch } from './store/store';
import type { ProgressReport, CompletionReport, ErrorReport } from './workers/scan.worker';

const Search = styled('div')(({ theme }) => ({
  position: 'relative',
  borderRadius: theme.shape.borderRadius,
  backgroundColor: alpha(theme.palette.common.white, 0.15),
  '&:hover': {
    backgroundColor: alpha(theme.palette.common.white, 0.25),
  },
  marginLeft: 0,
  width: '100%',
  [theme.breakpoints.up('sm')]: {
    marginLeft: theme.spacing(1),
    width: 'auto',
  },
}));

const SearchIconWrapper = styled('div')(({ theme }) => ({
  padding: theme.spacing(0, 2),
  height: '100%',
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  zIndex: 1, // Ensure the icon is clickable
}));

const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: 'inherit',
  width: '100%',
  '& .MuiInputBase-input': {
    padding: theme.spacing(1, 1, 1, 0),
    // vertical padding + font size from searchIcon
    paddingLeft: `calc(1em + ${theme.spacing(4)})`,
    transition: theme.transitions.create('width'),
    [theme.breakpoints.up('sm')]: {
      width: '12ch',
      '&:focus': {
        width: '20ch',
      },
    },
  },
}));

const modalStyle = {
  position: 'absolute' as 'absolute',
  top: '50%',
  left: '50%',
  transform: 'translate(-50%, -50%)',
  width: 400,
  bgcolor: 'background.paper',
  border: '2px solid #000',
  boxShadow: 24,
  p: 4,
};

function App() {
  const { t } = useTranslation();
  const dispatch = useDispatch<AppDispatch>();
  const scanWorker = useRef<Worker | null>(null);

  const [settingsOpen, setSettingsOpen] = useState(false);
  const [viewerOpen, setViewerOpen] = useState(false);
  const [currentPictureId, setCurrentPictureId] = useState<number | null>(null);
  const [sortedPictureIds, setSortedPictureIds] = useState<number[]>([]);
  const [filterSourceId, setFilterSourceId] = useState<number | 'all'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [inputValue, setInputValue] = useState('');
  
  const [scanProgress, setScanProgress] = useState(0);
  const [scanStatus, setScanStatus] = useState('');
  const [isScanning, setIsScanning] = useState(false);
  const [gridKey, setGridKey] = useState(0); // A key to manually remount the grid
  const [sourcesToVerify, setSourcesToVerify] = useState<DataSource[]>([]);

  const handleSearchSubmit = () => {
    setSearchTerm(inputValue);
  };

  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSearchSubmit();
    }
  };

  useEffect(() => {
    scanWorker.current = new Worker(new URL('./workers/scan.worker.ts', import.meta.url), { type: 'module' });

    scanWorker.current.onmessage = async (event: MessageEvent<ProgressReport | CompletionReport | ErrorReport>) => {
      const data = event.data;
      if (data.type === 'progress') {
        setScanStatus(data.statusText);
        setScanProgress(data.progress);
      } else if (data.type === 'complete') {
        setScanStatus('Saving changes to database...');
        try {
          const { adds, updates, deletes } = data;
          await db.transaction('rw', db.dataSources, db.pictures, async () => {
            if (deletes.length > 0) await db.pictures.bulkDelete(deletes);
            if (updates.length > 0) await db.pictures.bulkPut(updates);
            if (adds.length > 0) await db.pictures.bulkAdd(adds as any);
            
            const sources = await db.dataSources.toArray();
            for (const source of sources) {
              const count = await db.pictures.where('sourceId').equals(source.id!).count();
              await db.dataSources.update(source.id!, { pictureCount: count });
            }
          });
          console.log(`Scan complete: ${adds.length} added, ${updates.length} updated, ${deletes.length} deleted.`);
        } catch (e) { console.error("DB Error:", e); }
        
        // Force a remount of the grid after a scan to ensure stability
        setGridKey(prevKey => prevKey + 1);
        setIsScanning(false);

      } else if (data.type === 'error') {
          alert(`An error occurred in the scanner: ${data.message}`);
          setIsScanning(false);
      }
    };

    const checkPermissions = async () => {
      const localSources = await db.dataSources.where('type').equals('local').toArray();
      const sourcesToReverify: DataSource[] = [];
      for (const source of localSources) {
        const handle = source.path as FileSystemDirectoryHandle;
        // Silently check for permission status.
        const permissionStatus = await handle.queryPermission({ mode: 'read' });
        if (permissionStatus !== 'granted') {
          sourcesToReverify.push(source);
        }
      }
      if (sourcesToReverify.length > 0) {
        setSourcesToVerify(sourcesToReverify);
      }
    };
    checkPermissions();

    return () => scanWorker.current?.terminate();
  }, []);

  const dbDataSources = useLiveQuery(() => db.dataSources.toArray(), []);
  useEffect(() => {
    if (dbDataSources) {
      const serializableSources = dbDataSources.map(ds => ({ ...ds, path: ds.name }));
      dispatch(setSources(serializableSources));
    }
  }, [dbDataSources, dispatch]);

  const handleRefresh = async () => {
    const sources = await db.dataSources.where('enabled').equals(1).toArray();
    if (sources.length > 0) {
      setIsScanning(true);
      setScanProgress(0);
      setScanStatus('Preparing to scan...');
      const existingPictures = await db.pictures.toArray();
      scanWorker.current?.postMessage({ type: 'scan', sources, existingPictures });
    }
  };

  const handleVerificationComplete = () => {
    // Clear the list of sources that need verification
    setSourcesToVerify([]);
    // Revoke all old URLs and clear the cache to force re-creation
    imageUrlCache.revokeAndClear();
    // Remount the grid to re-fetch images with the newly granted permissions
    setGridKey(prevKey => prevKey + 1);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <AppBar position="static">
        <Toolbar>
          <Typography
            variant="h6"
            noWrap
            component="div"
            sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }}
          >
            {t('app_title')}
          </Typography>
          <Search>
            <SearchIconWrapper onClick={handleSearchSubmit}>
              <SearchIcon />
            </SearchIconWrapper>
            <StyledInputBase
              placeholder={t('search_placeholder') ?? "Search…"}
              inputProps={{ 'aria-label': 'search' }}
              value={inputValue}
              onChange={(e) => setInputValue(e.target.value)}
              onKeyDown={handleSearchKeyDown}
            />
          </Search>
          <IconButton color="inherit" onClick={handleRefresh} disabled={isScanning}><RefreshIcon /></IconButton>
          <IconButton color="inherit" onClick={() => setSettingsOpen(true)} disabled={isScanning}><SettingsIcon /></IconButton>
        </Toolbar>
      </AppBar>
      <Container component="main" sx={{ mt: 2, mb: 2 }} maxWidth={false}>
        <FilterChips selectedSourceId={filterSourceId} onSourceChange={setFilterSourceId} />
        <ErrorBoundary key={gridKey}>
          <ImageGrid 
            filterSourceId={filterSourceId}
            searchTerm={searchTerm}
            onPictureClick={(id) => { setCurrentPictureId(id); setViewerOpen(true); }} 
            onPicturesLoaded={setSortedPictureIds} 
          />
        </ErrorBoundary>
      </Container>
      <SettingsDialog open={settingsOpen} onClose={() => setSettingsOpen(false)} onScanRequest={handleRefresh} />
      <FullscreenViewer open={viewerOpen} onClose={() => setViewerOpen(false)} pictureId={currentPictureId} pictureIds={sortedPictureIds} onNavigate={setCurrentPictureId} />
      <PermissionManager sourcesToVerify={sourcesToVerify} onVerificationComplete={handleVerificationComplete} />
      <Modal open={isScanning}>
        <Box sx={modalStyle}>
          <Typography variant="h6" component="h2">Scanning in Progress</Typography>
          <Typography sx={{ mt: 2 }}>{scanStatus}</Typography>
          <LinearProgress variant="determinate" value={scanProgress} sx={{ mt: 2 }} />
        </Box>
      </Modal>
    </ThemeProvider>
  );
}

export default App;
