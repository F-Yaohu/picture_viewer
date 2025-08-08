import { useState, useEffect, useRef } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import DataSourceList from './DataSourceList';
import { db, type DataSource } from '../db/db';
import DialogContentText from '@mui/material/DialogContentText';
import RemoteSourceDialog from './RemoteSourceDialog';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onScanRequest: (sources?: DataSource[]) => void;
  onSyncSingleSource: (source: DataSource) => void;
}

declare global {
  interface Window { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>; }
  interface FileSystemDirectoryHandle { name: string; }
}

export default function SettingsDialog({ open, onClose, onScanRequest, onSyncSingleSource }: SettingsDialogProps) {
  const { t } = useTranslation();
  const [permissionDeniedOpen, setPermissionDeniedOpen] = useState(false);
  const [confirmRefreshOpen, setConfirmRefreshOpen] = useState(false);
  const [remoteSourceDialogOpen, setRemoteSourceDialogOpen] = useState(false);
  const [editingDataSource, setEditingDataSource] = useState<DataSource | undefined>(undefined);
  const initialState = useRef<string | null>(null);

  useEffect(() => {
    if (open) {
      const captureState = async () => {
        const sources = await db.dataSources.toArray();
        // We only care about settings the user can change in the dialog
        const relevantState = sources.map(s => ({ id: s.id, enabled: s.enabled, includeSubfolders: s.includeSubfolders }));
        initialState.current = JSON.stringify(relevantState);
      };
      captureState();
    }
  }, [open]);

  const handleEdit = (dataSource: DataSource) => {
    if (dataSource.type === 'remote') {
      setEditingDataSource(dataSource);
      setRemoteSourceDialogOpen(true);
    } else {
      // For local sources, "editing" means re-picking the folder.
      alert(t('edit_local_source_helper'));
    }
  };

  const handleSync = (dataSource: DataSource) => {
    onSyncSingleSource(dataSource);
  };


  const handleAddLocalFolder = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const directoryHandle = await window.showDirectoryPicker();
        
        // We must request permission here in the main thread before sending the handle to the worker.
        const permission = await directoryHandle.requestPermission({ mode: 'read' });
        if (permission !== 'granted') {
          setPermissionDeniedOpen(true);
          return;
        }

        await db.dataSources.add({
          name: directoryHandle.name,
          type: 'local',
          path: directoryHandle as any, 
          enabled: 1,
          includeSubfolders: true,
        });
        
      } catch (error) {
        // It's common for users to close the picker, which throws an AbortError.
        // We can safely ignore this specific error.
        if (error instanceof DOMException && error.name === 'AbortError') {
          console.log('User closed the directory picker.');
        } else {
          console.error('Error adding local folder:', error);
          // Optionally, show a user-facing error message here.
          alert(`An unexpected error occurred: ${error}`);
        }
      }
    } else {
      alert('Your browser does not support the File System Access API.');
    }
  };

  const handleClose = async () => {
    const currentSources = await db.dataSources.toArray();
    const relevantState = currentSources.map(s => ({ id: s.id, enabled: s.enabled, includeSubfolders: s.includeSubfolders }));
    const currentState = JSON.stringify(relevantState);

    if (initialState.current !== currentState) {
      setConfirmRefreshOpen(true);
    } else {
      onClose();
    }
  };

  const handleConfirmRefresh = async () => {
    setConfirmRefreshOpen(false);
    const allEnabledSources = await db.dataSources.where('enabled').equals(1).toArray();
    const localSourcesToScan = allEnabledSources.filter(s => s.type === 'local');
    onScanRequest(localSourcesToScan);
    onClose();
  };

  const handleDeclineRefresh = () => {
    setConfirmRefreshOpen(false);
    onClose();
  };

  return (
    <>
      <Dialog open={open} onClose={handleClose} fullWidth maxWidth="md">
        <DialogTitle>{t('settings_title')}</DialogTitle>
        <DialogContent dividers>
          <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
            <Typography variant="h6">{t('data_sources_title')}</Typography>
            <Box>
              <Button variant="contained" onClick={handleAddLocalFolder} sx={{ mr: 1 }}>
                {t('add_local_folder_button')}
              </Button>
              <Button variant="contained" onClick={() => setRemoteSourceDialogOpen(true)}>
                {t('add_remote_source_button')}
              </Button>
            </Box>
          </Box>
          <DataSourceList onEdit={handleEdit} onSync={handleSync} />
        </DialogContent>
        <DialogActions>
          <Button onClick={handleClose} autoFocus>{t('close_button')}</Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={permissionDeniedOpen}
        onClose={() => setPermissionDeniedOpen(false)}
      >
        <DialogTitle>{t('permission_denied_title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('permission_denied_message')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setPermissionDeniedOpen(false)} autoFocus>
            {t('ok_button')}
          </Button>
        </DialogActions>
      </Dialog>

      <Dialog
        open={confirmRefreshOpen}
        onClose={handleDeclineRefresh}
      >
        <DialogTitle>{t('confirm_refresh_title')}</DialogTitle>
        <DialogContent>
          <DialogContentText>
            {t('confirm_refresh_message')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={handleDeclineRefresh}>{t('later_button')}</Button>
          <Button onClick={handleConfirmRefresh} autoFocus>
            {t('refresh_now_button')}
          </Button>
        </DialogActions>
      </Dialog>

      <RemoteSourceDialog 
        open={remoteSourceDialogOpen}
        onClose={() => {
          setRemoteSourceDialogOpen(false);
          setEditingDataSource(undefined);
        }}
        dataSource={editingDataSource}
      />
    </>
  );
}
