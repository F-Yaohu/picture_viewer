import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import Box from '@mui/material/Box';
import Typography from '@mui/material/Typography';
import { useTranslation } from 'react-i18next';
import DataSourceList from './DataSourceList';
import { db } from '../db/db';

interface SettingsDialogProps {
  open: boolean;
  onClose: () => void;
  onScanRequest: () => void; // Callback to request a scan
}

declare global {
  interface Window { showDirectoryPicker: () => Promise<FileSystemDirectoryHandle>; }
  interface FileSystemDirectoryHandle { name: string; }
}

export default function SettingsDialog({ open, onClose, onScanRequest }: SettingsDialogProps) {
  const { t } = useTranslation();

  const handleAddLocalFolder = async () => {
    if ('showDirectoryPicker' in window) {
      try {
        const directoryHandle = await window.showDirectoryPicker();
        
        // We must request permission here in the main thread before sending the handle to the worker.
        const permission = await directoryHandle.requestPermission({ mode: 'read' });
        if (permission !== 'granted') {
          alert('Permission to read the folder was denied.');
          return;
        }

        await db.dataSources.add({
          name: directoryHandle.name,
          type: 'local',
          path: directoryHandle as any, 
          enabled: 1,
          includeSubfolders: true,
        });
        
        // Request a scan from the main App component
        onScanRequest();

      } catch (error) {
        console.error('Error adding local folder:', error);
      }
    } else {
      alert('Your browser does not support the File System Access API.');
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{t('settings_title')}</DialogTitle>
      <DialogContent dividers>
        <Box sx={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', mb: 2 }}>
          <Typography variant="h6">{t('data_sources_title')}</Typography>
          <Button variant="contained" onClick={handleAddLocalFolder}>
            {t('add_local_folder_button')}
          </Button>
        </Box>
        <DataSourceList />
      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('close_button')}</Button>
      </DialogActions>
    </Dialog>
  );
}
