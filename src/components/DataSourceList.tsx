import { useCallback, useEffect, useMemo, useState } from 'react';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import Checkbox from '@mui/material/Checkbox';
import Switch from '@mui/material/Switch';
import IconButton from '@mui/material/IconButton';
import Tooltip from '@mui/material/Tooltip';
import Collapse from '@mui/material/Collapse';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogActions from '@mui/material/DialogActions';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import CircularProgress from '@mui/material/CircularProgress';
import Divider from '@mui/material/Divider';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SyncIcon from '@mui/icons-material/Sync';
import ExpandLess from '@mui/icons-material/ExpandLess';
import ExpandMore from '@mui/icons-material/ExpandMore';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db, type DataSource } from '../db/db';
import { imageUrlCache } from '../utils/imageUrlCache';

type CategoryKey = 'local' | 'remote' | 'server';

interface FolderNode {
  name: string;
  path: string;
  children: FolderNode[];
}

interface DataSourceListProps {
  serverSources: DataSource[];
  selectedSourceIds: number[];
  allSourceIds: number[];
  onSelectedSourceIdsChange: (ids: number[]) => void | Promise<void>;
  onEdit: (dataSource: DataSource) => void;
  onSync: (dataSource: DataSource) => void;
  dialogOpen: boolean;
}

const MAX_FOLDER_DEPTH = 2;

export default function DataSourceList({ serverSources, selectedSourceIds, allSourceIds, onSelectedSourceIdsChange, onEdit, onSync, dialogOpen }: DataSourceListProps) {
  const { t } = useTranslation();
  const dataSources = useLiveQuery(() => db.dataSources.toArray(), []);
  const [categoryExpanded, setCategoryExpanded] = useState<Record<CategoryKey, boolean>>({ local: true, remote: true, server: true });
  const [sourceExpansion, setSourceExpansion] = useState<Record<number, boolean>>({});
  const [folderExpansion, setFolderExpansion] = useState<Record<number, Set<string>>>({});
  const [folderTrees, setFolderTrees] = useState<Record<number, FolderNode[]>>({});
  const [loadingFolders, setLoadingFolders] = useState<Record<number, boolean>>({});
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [sourcePendingDelete, setSourcePendingDelete] = useState<DataSource | null>(null);

  const localSources = useMemo(() => (dataSources ?? []).filter(source => source.type === 'local'), [dataSources]);
  const remoteSources = useMemo(() => (dataSources ?? []).filter(source => source.type === 'remote'), [dataSources]);
  const serverSourceList = useMemo(() => serverSources ?? [], [serverSources]);

  const selectedSet = useMemo(() => new Set(selectedSourceIds), [selectedSourceIds]);

  const applySelection = useCallback((set: Set<number>) => {
    const ordered = allSourceIds.filter(id => set.has(id));
    const additions = Array.from(set).filter(id => !ordered.includes(id));
    onSelectedSourceIdsChange([...ordered, ...additions]);
  }, [allSourceIds, onSelectedSourceIdsChange]);

  const collectIds = (sources: DataSource[]) => sources.map(source => source.id).filter((id): id is number => typeof id === 'number');

  const categorySources: Record<CategoryKey, DataSource[]> = useMemo(() => ({
    local: localSources,
    remote: remoteSources,
    server: serverSourceList,
  }), [localSources, remoteSources, serverSourceList]);

  const getCategoryState = useCallback((category: CategoryKey) => {
    const ids = collectIds(categorySources[category]);
    const selectedCount = ids.filter(id => selectedSet.has(id)).length;
    return {
      selectedCount,
      totalCount: ids.length,
      checked: ids.length > 0 && selectedCount === ids.length,
      indeterminate: selectedCount > 0 && selectedCount < ids.length,
    };
  }, [categorySources, selectedSet]);

  const toggleCategory = (category: CategoryKey) => {
    setCategoryExpanded(prev => ({ ...prev, [category]: !prev[category] }));
  };

  const handleCategorySelection = (category: CategoryKey, checked: boolean) => {
    const ids = collectIds(categorySources[category]);
    const next = new Set(selectedSet);
    ids.forEach(id => {
      if (checked) next.add(id);
      else next.delete(id);
    });
    applySelection(next);
  };

  const handleToggleSelection = (sourceId: number, checked: boolean) => {
    const next = new Set(selectedSet);
    if (checked) next.add(sourceId);
    else next.delete(sourceId);
    applySelection(next);
  };

  const updateFolderExpansion = (sourceId: number, path: string) => {
    setFolderExpansion(prev => {
      const existing = new Set(prev[sourceId] ?? []);
      if (existing.has(path)) {
        existing.delete(path);
      } else {
        existing.add(path);
      }
      return { ...prev, [sourceId]: existing };
    });
  };

  const loadFoldersForSource = useCallback(async (source: DataSource) => {
    if (!source || typeof source.id !== 'number' || source.type !== 'local') return;
    if (folderTrees[source.id] || loadingFolders[source.id]) return;

    const handle = source.path as unknown as FileSystemDirectoryHandle;
    let permission = await handle.queryPermission({ mode: 'read' });
    if (permission !== 'granted') {
      permission = await handle.requestPermission({ mode: 'read' });
      if (permission !== 'granted') return;
    }

    setLoadingFolders(prev => ({ ...prev, [source.id!]: true }));
    try {
      const tree = await buildFolderTree(handle, MAX_FOLDER_DEPTH);
      setFolderTrees(prev => ({ ...prev, [source.id!]: tree }));
    } catch (error) {
      console.warn(`Failed to enumerate folders for ${source.name}`, error);
    } finally {
      setLoadingFolders(prev => ({ ...prev, [source.id!]: false }));
    }
  }, [folderTrees, loadingFolders]);

  useEffect(() => {
    if (!dialogOpen) return;
    const ids = new Set<number>();
    for (const source of localSources) {
      if (typeof source.id === 'number') ids.add(source.id);
    }

    setSourceExpansion(prev => {
      let changed = false;
      const next: Record<number, boolean> = {};
      ids.forEach(id => {
        const prevValue = prev[id] ?? false;
        next[id] = prevValue;
        if (!(id in prev)) changed = true;
      });
      for (const key of Object.keys(prev)) {
        const id = Number(key);
        if (!ids.has(id)) {
          changed = true;
          break;
        }
      }
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });

    setFolderExpansion(prev => {
      let changed = false;
      const next: Record<number, Set<string>> = {};
      ids.forEach(id => {
        if (prev[id]) {
          next[id] = prev[id];
        } else {
          next[id] = new Set();
          changed = true;
        }
      });
      for (const key of Object.keys(prev)) {
        const id = Number(key);
        if (!ids.has(id)) {
          changed = true;
          break;
        }
      }
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });

    setFolderTrees(prev => {
      let changed = false;
      const next: Record<number, FolderNode[]> = {};
      ids.forEach(id => {
        if (prev[id]) {
          next[id] = prev[id];
        } else {
          changed = true;
        }
      });
      for (const key of Object.keys(prev)) {
        const id = Number(key);
        if (!ids.has(id)) {
          changed = true;
          break;
        }
      }
      if (!changed && Object.keys(prev).length === Object.keys(next).length) {
        return prev;
      }
      return next;
    });
  }, [dialogOpen, localSources]);

  const handleSourceExpandToggle = async (source: DataSource) => {
    if (typeof source.id !== 'number') return;
    setSourceExpansion(prev => ({ ...prev, [source.id!]: !prev[source.id!] }));
    if (!sourceExpansion[source.id] && source.type === 'local') {
      await loadFoldersForSource(source);
    }
  };

  const handleDelete = (source: DataSource) => {
    setSourcePendingDelete(source);
    setDeleteDialogOpen(true);
  };

  const closeDeleteDialog = () => {
    setDeleteDialogOpen(false);
    setSourcePendingDelete(null);
  };

  const confirmDelete = async () => {
    if (!sourcePendingDelete || typeof sourcePendingDelete.id !== 'number') return;
    const id = sourcePendingDelete.id;
    try {
      const picturesToDelete = await db.pictures.where('sourceId').equals(id).toArray();
      await db.transaction('rw', db.dataSources, db.pictures, async () => {
        await db.pictures.where('sourceId').equals(id).delete();
        await db.dataSources.delete(id);
      });
      picturesToDelete.forEach(pic => {
        if (pic.id && imageUrlCache.has(pic.id)) {
          const url = imageUrlCache.get(pic.id)!;
          URL.revokeObjectURL(url);
          imageUrlCache.delete(pic.id);
        }
      });
      const next = new Set(selectedSet);
      next.delete(id);
      applySelection(next);
    } catch (error) {
      console.error('Failed to delete data source:', error);
    } finally {
      closeDeleteDialog();
    }
  };

  const handleToggleEnabled = async (source: DataSource, checked: boolean) => {
    if (typeof source.id !== 'number') return;
    await db.dataSources.update(source.id, { enabled: checked ? 1 : 0 });
    const next = new Set(selectedSet);
    if (checked) next.add(source.id);
    else next.delete(source.id);
    applySelection(next);
  };

  const handleToggleIncludeSubfolders = async (source: DataSource) => {
    if (typeof source.id !== 'number') return;
    const current = !!source.includeSubfolders;
    await db.dataSources.update(source.id, { includeSubfolders: !current });
  };

  const handleToggleFolder = async (source: DataSource, folderPath: string, include: boolean) => {
    if (typeof source.id !== 'number') return;
    const disabled = new Set(source.disabledFolders ?? []);
    if (include) {
      for (const entry of Array.from(disabled)) {
        if (entry === folderPath || entry.startsWith(`${folderPath}/`)) {
          disabled.delete(entry);
        }
      }
    } else {
      disabled.add(folderPath);
    }
    await db.dataSources.update(source.id, { disabledFolders: Array.from(disabled) });
  };

  const renderFolderNode = (source: DataSource, node: FolderNode, depth = 0, parentExcluded = false, disabledSetParam?: Set<string>) => {
    if (typeof source.id !== 'number') return null;
    const disabledSet = disabledSetParam ?? new Set(source.disabledFolders ?? []);
    const isExplicitlyExcluded = disabledSet.has(node.path);
    const isEffectivelyExcluded = parentExcluded || isExplicitlyExcluded;
    const selectionState = computeFolderSelection(node, disabledSet, parentExcluded);
    const pathExpanded = folderExpansion[source.id]?.has(node.path) ?? false;
    const indeterminate = !isEffectivelyExcluded && selectionState.someIncluded && !selectionState.allIncluded;

    return (
      <Box key={`${source.id}-${node.path}`} sx={{ pl: 3 + depth * 2 }}>
        <Box sx={{ display: 'flex', alignItems: 'center', gap: 1 }}>
          {node.children.length > 0 ? (
            <IconButton size="small" onClick={() => updateFolderExpansion(source.id!, node.path)}>
              {pathExpanded ? <ExpandLess fontSize="small" /> : <ExpandMore fontSize="small" />}
            </IconButton>
          ) : (
            <Box sx={{ width: 32 }} />
          )}
          <Checkbox
            size="small"
            checked={!isEffectivelyExcluded}
            indeterminate={indeterminate}
            disabled={parentExcluded}
            onChange={(event) => handleToggleFolder(source, node.path, event.target.checked)}
          />
          <Typography variant="body2" noWrap>{node.name}</Typography>
        </Box>
        {node.children.length > 0 && (
          <Collapse in={pathExpanded} timeout="auto" unmountOnExit>
            {node.children.map(child => renderFolderNode(source, child, depth + 1, isEffectivelyExcluded, disabledSet))}
          </Collapse>
        )}
      </Box>
    );
  };

  const renderSourceRow = (source: DataSource, category: CategoryKey) => {
    if (typeof source.id !== 'number') return null;
    const isSelected = selectedSet.has(source.id);
    const isExpanded = !!sourceExpansion[source.id];
  const disabledFolders = source.disabledFolders ?? [];
  const disabledSet = new Set(disabledFolders);
    const folderNodes = folderTrees[source.id] || [];
    const isLoadingFolders = loadingFolders[source.id];

    const remoteLabel = category === 'remote' ? (source.remoteConfig?.url ?? '') : undefined;
    const serverLabel = category === 'server' ? t('server_source_label') : undefined;
    const secondaryLabel = remoteLabel || serverLabel || undefined;

    return (
      <Box key={`${category}-${source.id}`} sx={{ borderBottom: '1px solid', borderColor: 'divider' }}>
        <ListItem>
          <Checkbox
            edge="start"
            checked={isSelected}
            onChange={(event) => handleToggleSelection(source.id!, event.target.checked)}
            inputProps={{ 'aria-label': `${t('filter_by_source')} ${source.name}` }}
          />
          <ListItemText
            primary={source.name}
            secondary={secondaryLabel}
          />
          <Chip label={`${source.pictureCount ?? 0} items`} size="small" sx={{ mr: 2 }} />
          {category !== 'server' && (
            <Tooltip title={t('toggle_source_enabled')}>
              <Switch
                size="small"
                checked={!!source.enabled}
                onChange={(event) => handleToggleEnabled(source, event.target.checked)}
              />
            </Tooltip>
          )}
          {category === 'local' && (
            <Tooltip title={t('include_subfolders_tooltip')}>
              <Checkbox
                size="small"
                checked={!!source.includeSubfolders}
                onChange={() => handleToggleIncludeSubfolders(source)}
                icon={<FolderZipIcon fontSize="small" />}
                checkedIcon={<FolderZipIcon fontSize="small" />}
              />
            </Tooltip>
          )}
          {category === 'remote' && (
            <>
              <Tooltip title={t('sync_source_tooltip')}>
                <IconButton size="small" onClick={() => onSync(source)}>
                  <SyncIcon fontSize="small" />
                </IconButton>
              </Tooltip>
              <Tooltip title={t('edit_source_tooltip')}>
                <IconButton size="small" onClick={() => onEdit(source)}>
                  <EditIcon fontSize="small" />
                </IconButton>
              </Tooltip>
            </>
          )}
          {category !== 'server' && (
            <Tooltip title={t('delete_source_tooltip')}>
              <IconButton size="small" onClick={() => handleDelete(source)}>
                <DeleteIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          )}
          {category === 'local' && (
            <IconButton size="small" onClick={() => handleSourceExpandToggle(source)}>
              {isExpanded ? <ExpandLess /> : <ExpandMore />}
            </IconButton>
          )}
        </ListItem>
        {category === 'local' && (
          <Collapse in={isExpanded} timeout="auto" unmountOnExit>
            <Box sx={{ pl: 5, pr: 1, pb: 1 }}>
              {isLoadingFolders ? (
                <Box sx={{ display: 'flex', alignItems: 'center', gap: 1, py: 1 }}>
                  <CircularProgress size={16} />
                  <Typography variant="body2" color="text.secondary">
                    {t('loading')}
                  </Typography>
                </Box>
              ) : folderNodes.length === 0 ? (
                <Typography variant="body2" color="text.secondary">
                  {t('no_local_subfolders', 'No subfolders detected or permission denied.')}
                </Typography>
              ) : (
                <Box sx={{ maxHeight: 280, overflowY: 'auto', pr: 1 }}>
                  {folderNodes.map(node => renderFolderNode(source, node, 0, false, disabledSet))}
                </Box>
              )}
              {disabledFolders.length > 0 && (
                <Typography variant="caption" color="text.secondary" sx={{ mt: 1, display: 'block' }}>
                  {t('excluded_folders_hint', 'Unchecked folders will be skipped during the next scan.')}
                </Typography>
              )}
            </Box>
          </Collapse>
        )}
      </Box>
    );
  };

  const categories: Array<{ key: CategoryKey; label: string; emptyMessage: string }> = [
    { key: 'local', label: t('local_sources_heading', 'Local folders'), emptyMessage: t('no_local_sources', 'No local folders added yet.') },
    { key: 'remote', label: t('remote_sources_heading', 'Remote sources'), emptyMessage: t('no_remote_sources', 'No remote sources configured yet.') },
    { key: 'server', label: t('server_sources_heading', 'Server sources'), emptyMessage: t('no_server_sources', 'No server sources configured.') },
  ];

  return (
    <>
      <Box sx={{ borderRadius: 1, border: '1px solid', borderColor: 'divider' }}>
        {categories.map(({ key, label, emptyMessage }) => {
          const { checked, indeterminate, selectedCount, totalCount } = getCategoryState(key);
          const hasSources = categorySources[key].length > 0;
          return (
            <Box key={key}>
              <Box sx={{ display: 'flex', alignItems: 'center', px: 2, py: 1.5, backgroundColor: 'action.hover' }}>
                <Checkbox
                  edge="start"
                  checked={checked}
                  indeterminate={indeterminate}
                  disabled={!hasSources}
                  onChange={(event) => handleCategorySelection(key, event.target.checked)}
                  sx={{ mr: 1 }}
                />
                <Box sx={{ flexGrow: 1 }} onClick={() => toggleCategory(key)} role="button">
                  <Typography variant="subtitle2">{`${label} (${selectedCount}/${totalCount})`}</Typography>
                </Box>
                <IconButton size="small" onClick={() => toggleCategory(key)}>
                  {categoryExpanded[key] ? <ExpandLess /> : <ExpandMore />}
                </IconButton>
              </Box>
              <Collapse in={categoryExpanded[key]} timeout="auto" unmountOnExit>
                {!hasSources ? (
                  <Typography variant="body2" color="text.secondary" sx={{ px: 3, py: 2 }}>{emptyMessage}</Typography>
                ) : (
                  <List disablePadding>
                    {categorySources[key].map(source => renderSourceRow(source, key))}
                  </List>
                )}
              </Collapse>
              <Divider />
            </Box>
          );
        })}
      </Box>

      <Dialog open={deleteDialogOpen} onClose={closeDeleteDialog} aria-labelledby="delete-source-title" aria-describedby="delete-source-description">
        <DialogTitle id="delete-source-title">{t('confirm_delete_source_title')}</DialogTitle>
        <DialogContent>
          <DialogContentText id="delete-source-description">{t('confirm_delete_source_message')}</DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={closeDeleteDialog}>{t('cancel_button')}</Button>
          <Button onClick={confirmDelete} autoFocus>{t('delete_button')}</Button>
        </DialogActions>
      </Dialog>
    </>
  );
}

async function buildFolderTree(handle: FileSystemDirectoryHandle, depth: number, basePath = ''): Promise<FolderNode[]> {
  if (depth <= 0) return [];
  const nodes: FolderNode[] = [];
  for await (const entry of handle.values()) {
    if (entry.kind !== 'directory') continue;
    const dirHandle = entry as FileSystemDirectoryHandle;
    const currentPath = basePath ? `${basePath}/${entry.name}` : entry.name;
    const children = depth > 1 ? await buildFolderTree(dirHandle, depth - 1, currentPath) : [];
    nodes.push({ name: entry.name, path: currentPath, children });
  }
  nodes.sort((a, b) => a.name.localeCompare(b.name));
  return nodes;
}

function computeFolderSelection(node: FolderNode, disabledSet: Set<string>, ancestorExcluded = false): { allIncluded: boolean; someIncluded: boolean } {
  const selfExcluded = ancestorExcluded || disabledSet.has(node.path);
  if (node.children.length === 0) {
    const included = !selfExcluded;
    return { allIncluded: included, someIncluded: included };
  }

  let allChildrenIncluded = true;
  let someChildrenIncluded = false;
  for (const child of node.children) {
    const childState = computeFolderSelection(child, disabledSet, selfExcluded);
    if (!childState.allIncluded) {
      allChildrenIncluded = false;
    }
    if (childState.someIncluded) {
      someChildrenIncluded = true;
    }
  }

  const selfIncluded = !selfExcluded;
  const allIncluded = selfIncluded && allChildrenIncluded;
  const someIncluded = selfIncluded || someChildrenIncluded;
  return { allIncluded, someIncluded };
}
