import { useState, useEffect, useRef } from 'react';
import { useDispatch } from 'react-redux';
import { ThemeProvider, styled, alpha } from '@mui/material/styles';
import Slide from '@mui/material/Slide';
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
import { ErrorBoundary } from './components/ErrorBoundary'; // 错误边界组件
import FilterChips from './components/FilterChips';
import { db, type DataSource, type Picture } from './db/db';
import { imageUrlCache } from './utils/imageUrlCache';
import { setSources } from './store/slices/dataSourceSlice';
import type { AppDispatch } from './store/store';
import type { ProgressReport, CompletionReport, ErrorReport } from './workers/scan.worker';

// 搜索框样式
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

// 搜索图标样式
const SearchIconWrapper = styled('div')(({ theme }) => ({
  padding: theme.spacing(0, 2),
  height: '100%',
  position: 'absolute',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  cursor: 'pointer',
  zIndex: 1, // 保证图标可点击
}));

// 输入框样式
const StyledInputBase = styled(InputBase)(({ theme }) => ({
  color: 'inherit',
  width: '100%',
  '& .MuiInputBase-input': {
    padding: theme.spacing(1, 1, 1, 0),
    // 左侧为搜索图标预留空间
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

// 扫描进度弹窗样式
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

  // 组件状态定义
  const [settingsOpen, setSettingsOpen] = useState(false); // 设置弹窗开关
  const [viewerOpen, setViewerOpen] = useState(false); // 全屏图片查看器开关
  const [currentPicture, setCurrentPicture] = useState<Picture | null>(null); // 当前查看图片对象
  const [sortedPictures, setSortedPictures] = useState<Picture[]>([]); // Store the full picture objects for navigation
  const [filterSourceId, setFilterSourceId] = useState<number | 'all'>('all'); // 数据源筛选
  const [searchTerm, setSearchTerm] = useState(''); // 搜索关键词
  const [inputValue, setInputValue] = useState(''); // 搜索输入框内容
  
  const [scanProgress, setScanProgress] = useState(0); // 扫描进度
  const [scanStatus, setScanStatus] = useState(''); // 扫描状态文本
  const [isScanning, setIsScanning] = useState(false); // 是否正在扫描
  const [gridKey, setGridKey] = useState(0); // 用于强制重载图片网格
  const [sourcesToVerify, setSourcesToVerify] = useState<DataSource[]>([]); // 需要重新授权的本地数据源
  const [serverSources, setServerSources] = useState<DataSource[]>([]);
  const [gridSettings, setGridSettings] = useState<{ rowHeight: number; gap: number; groupBy: 'day'|'week'|'month' }>({ rowHeight: 220, gap: 12, groupBy: 'day' });
  const [hideAppBar, setHideAppBar] = useState(false);
  const lastScrollY = useRef<number>(0);

  // 搜索提交
  const handleSearchSubmit = () => {
    setSearchTerm(inputValue);
  };
  
  // 新增：从后端获取服务端数据源
  useEffect(() => {
    // Auto-hide AppBar on scroll down, show on scroll up
    const onScroll = () => {
      const currentY = window.scrollY || window.pageYOffset;
      if (currentY > lastScrollY.current + 10) {
        // scrolled down
        setHideAppBar(true);
      } else if (currentY < lastScrollY.current - 10) {
        // scrolled up
        setHideAppBar(false);
      }
      lastScrollY.current = currentY;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  // 新增：从后端获取服务端数据
  useEffect(() => {
    const fetchServerData = async () => {
      try {
        const response = await fetch('/api/server-data');
        if (response.ok) {
          const data = await response.json();
          setServerSources(data.sources || []);
        } else {
          console.error('Failed to fetch server data');
        }
      } catch (error) {
        console.error('Error fetching server data:', error);
      }
    };
    fetchServerData();
  }, []);

  // Load persisted grid settings from DB (if any)
  useEffect(() => {
    const load = async () => {
      try {
        const entry = await db.settings.get('gridSettings');
        if (entry && entry.value) {
          setGridSettings(entry.value);
        }
      } catch (e) {
        console.warn('Failed to load grid settings:', e);
      }
    };
    load();
  }, []);

  // Persist grid settings whenever they change
  useEffect(() => {
    const save = async () => {
      try {
        await db.settings.put({ key: 'gridSettings', value: gridSettings });
      } catch (e) {
        console.warn('Failed to save grid settings:', e);
      }
    };
    save();
  }, [gridSettings]);

  // 回车触发搜索
  const handleSearchKeyDown = (event: React.KeyboardEvent) => {
    if (event.key === 'Enter') {
      handleSearchSubmit();
    }
  };

  // 初始化：创建扫描worker、检查本地文件夹权限
  useEffect(() => {
    // 创建Web Worker用于图片扫描
    scanWorker.current = new Worker(new URL('./workers/scan.worker.ts', import.meta.url), { type: 'module' });

    // 监听worker消息，处理进度、完成、错误
    scanWorker.current.onmessage = async (event: MessageEvent<ProgressReport | CompletionReport | ErrorReport>) => {
      const data = event.data;
      if (data.type === 'progress') {
        setScanStatus(data.statusText);
        setScanProgress(data.progress);
      } else if (data.type === 'complete') {
        setScanStatus('Saving changes to database...');
        try {
          const { adds, updates, deletes } = data;
          // 批量写入数据库
          await db.transaction('rw', db.dataSources, db.pictures, async () => {
            if (deletes.length > 0) await db.pictures.bulkDelete(deletes);
            if (updates.length > 0) await db.pictures.bulkPut(updates);
            if (adds.length > 0) await db.pictures.bulkAdd(adds as any);
            
            // 更新每个数据源的图片数量
            const sources = await db.dataSources.toArray();
            for (const source of sources) {
              const count = await db.pictures.where('sourceId').equals(source.id!).count();
              await db.dataSources.update(source.id!, { pictureCount: count });
            }
          });
          console.log(`Scan complete: ${adds.length} added, ${updates.length} updated, ${deletes.length} deleted.`);
        } catch (e) { console.error("DB Error:", e); }
        
        // 扫描完成后强制重载图片网格，确保稳定
        setGridKey(prevKey => prevKey + 1);
        setIsScanning(false);

      } else if (data.type === 'error') {
          alert(`An error occurred in the scanner: ${data.message}`);
          setIsScanning(false);
      }
    };

    // 检查本地文件夹权限，若失效则提示用户重新授权
    const checkPermissions = async () => {
      const localSources = await db.dataSources.where('type').equals('local').toArray();
      const sourcesToReverify: DataSource[] = [];
      for (const source of localSources) {
        const handle = source.path as FileSystemDirectoryHandle;
        // 静默检查权限
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

    // 组件卸载时终止worker
    return () => scanWorker.current?.terminate();
  }, []);

  // 监听数据源变化，同步到redux
  const dbDataSources = useLiveQuery(() => db.dataSources.toArray(), []);
  useEffect(() => {
    if (dbDataSources) {
      // 只序列化path为name，避免存储不可序列化对象
      const serializableSources = dbDataSources.map(ds => ({ ...ds, path: ds.name }));
      dispatch(setSources(serializableSources));
    }
  }, [dbDataSources, dispatch]);

  // 扫描指定数据源（本地或远程）
  const handleRefresh = async (sourcesToScan?: DataSource[]) => {
    const sources = sourcesToScan || await db.dataSources.where('enabled').equals(1).toArray();
    if (sources.length > 0) {
      setIsScanning(true);
      setScanProgress(0);
      setScanStatus('Preparing to scan...');
      const existingPictures = await db.pictures.toArray();
      const sourceIdsToScan = sources.map(s => s.id!);
      scanWorker.current?.postMessage({ type: 'scan', sources, existingPictures, sourceIdsToScan });
    }
  };

  // 全局刷新（只扫描本地数据源）
  const handleGlobalRefresh = async () => {
    const allEnabledSources = await db.dataSources.where('enabled').equals(1).toArray();
    const localSourcesToScan = allEnabledSources.filter(s => s.type === 'local');
    handleRefresh(localSourcesToScan);
  };

  // 同步单个数据源
  const handleSyncSingleSource = (source: DataSource) => {
    handleRefresh([source]);
    setSettingsOpen(false); // 同步后关闭设置弹窗
  };

  // 合并客户端和服务端数据源
  const combinedSources = [...(dbDataSources || []), ...serverSources];

  // 本地文件夹重新授权完成后回调
  const handleVerificationComplete = () => {
    setSourcesToVerify([]);
    imageUrlCache.revokeAndClear(); // 清空图片URL缓存
    setGridKey(prevKey => prevKey + 1); // 强制重载图片网格
  };

  // This function now receives the full, sorted list of pictures from ImageGrid
  const handlePicturesLoaded = (allPictures: Picture[]) => {
    setSortedPictures(allPictures);
  };

  const handlePictureClick = (picture: Picture) => {
    setCurrentPicture(picture);
    setViewerOpen(true);
  };

  const handleNavigation = (currentId: number, direction: 'prev' | 'next') => {
    const currentIndex = sortedPictures.findIndex(p => p.id === currentId);
    if (currentIndex === -1) return;

    let nextIndex;
    if (direction === 'next') {
      nextIndex = (currentIndex + 1) % sortedPictures.length;
    } else {
      nextIndex = (currentIndex - 1 + sortedPictures.length) % sortedPictures.length;
    }
    setCurrentPicture(sortedPictures[nextIndex]);
  };

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      {/* 顶部应用栏（自动隐藏/显示） */}
      <Slide appear={false} direction="down" in={!hideAppBar}>
        <AppBar position="sticky"> 
          <Toolbar>
          <Typography
            variant="h6"
            noWrap
            component="div"
            sx={{ flexGrow: 1, display: { xs: 'none', sm: 'block' } }}
          >
            {t('app_title')}
          </Typography>
          {/* 搜索框 */}
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
          {/* 刷新按钮 */}
          <IconButton color="inherit" onClick={handleGlobalRefresh} disabled={isScanning}><RefreshIcon /></IconButton>
          {/* 设置按钮 */}
          <IconButton color="inherit" onClick={() => setSettingsOpen(true)} disabled={isScanning}><SettingsIcon /></IconButton>
          </Toolbar>
        </AppBar>
      </Slide>
      {/* 主体内容区 */}
      <Container component="main" sx={{ mt: 2, mb: 2 }} maxWidth={false}>
        {/* 数据源筛选标签 */}
        <FilterChips allSources={combinedSources} selectedSourceId={filterSourceId} onSourceChange={setFilterSourceId} />
        {/* 错误边界包裹图片网格，防止渲染异常导致页面崩溃 */}
        <ErrorBoundary key={gridKey}>
          <ImageGrid 
            filterSourceId={filterSourceId}
            searchTerm={searchTerm}
            serverSources={serverSources}
            onPictureClick={handlePictureClick} 
            onPicturesLoaded={handlePicturesLoaded}
            rowHeight={gridSettings.rowHeight}
            gap={gridSettings.gap}
            groupBy={gridSettings.groupBy}
          />
        </ErrorBoundary>
      </Container>
      {/* 设置弹窗 */}
      <SettingsDialog 
        open={settingsOpen} 
        onClose={() => setSettingsOpen(false)} 
        onScanRequest={handleRefresh}
        onSyncSingleSource={handleSyncSingleSource}
        gridSettings={gridSettings}
        onGridSettingsChange={(next) => setGridSettings(next)}
      />
      {/* 全屏图片查看器 */}
      <FullscreenViewer 
        open={viewerOpen} 
        onClose={() => setViewerOpen(false)} 
        picture={currentPicture} 
        onNavigate={(direction) => currentPicture && handleNavigation(currentPicture.id!, direction)} 
      />
      {/* 本地文件夹权限管理弹窗 */}
      <PermissionManager sourcesToVerify={sourcesToVerify} onVerificationComplete={handleVerificationComplete} />
      {/* 扫描进度弹窗 */}
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
