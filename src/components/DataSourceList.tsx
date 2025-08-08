import { useState } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Checkbox from '@mui/material/Checkbox';
import DeleteIcon from '@mui/icons-material/Delete';
import EditIcon from '@mui/icons-material/Edit';
import SyncIcon from '@mui/icons-material/Sync';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import Button from '@mui/material/Button';
import Dialog from '@mui/material/Dialog';
import DialogActions from '@mui/material/DialogActions';
import DialogContent from '@mui/material/DialogContent';
import DialogContentText from '@mui/material/DialogContentText';
import DialogTitle from '@mui/material/DialogTitle';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db, type DataSource } from '../db/db';
import { imageUrlCache } from '../utils/imageUrlCache';

interface DataSourceListProps {
  onEdit: (dataSource: DataSource) => void;
  onSync: (dataSource: DataSource) => void;
}

export default function DataSourceList({ onEdit, onSync }: DataSourceListProps) {
  const { t } = useTranslation();
  const dataSources = useLiveQuery(() => db.dataSources.toArray(), []);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [sourceToDelete, setSourceToDelete] = useState<number | null>(null);

  const handleDelete = (id: number) => {
    setSourceToDelete(id);
    setDialogOpen(true);
  };

  const confirmDelete = async () => {
    if (sourceToDelete === null) return;

    try {
      const picturesToDelete = await db.pictures.where('sourceId').equals(sourceToDelete).toArray();
      await db.transaction('rw', db.dataSources, db.pictures, async () => {
        await db.pictures.where('sourceId').equals(sourceToDelete).delete();
        await db.dataSources.delete(sourceToDelete);
      });
      picturesToDelete.forEach(pic => {
        if (pic.id && imageUrlCache.has(pic.id)) {
          const url = imageUrlCache.get(pic.id)!;
          URL.revokeObjectURL(url);
          imageUrlCache.delete(pic.id);
        }
      });
    } catch (error) {
      console.error('Failed to delete data source:', error);
    } finally {
      setDialogOpen(false);
      setSourceToDelete(null);
    }
  };

  const handleToggleEnabled = (id: number, isChecked: boolean) => {
    db.dataSources.update(id, { enabled: isChecked ? 1 : 0 });
  };

  const handleToggleSubfolders = (id: number, currentStatus: boolean) => {
    db.dataSources.update(id, { includeSubfolders: !currentStatus });
  };

  if (!dataSources) return <Typography>{t('loading')}</Typography>;
  if (dataSources.length === 0) {
    return <Typography align="center">{t('no_sources_added')}</Typography>;
  }

  return (
    <>
      <List>
        {dataSources.map((source) => (
          <ListItem key={source.id} divider>
            <Box sx={{ display: 'flex', alignItems: 'center', width: '100%' }}>
              <Switch
                edge="start"
                checked={!!source.enabled}
                onChange={(e) => handleToggleEnabled(source.id!, e.target.checked)}
              />
              <ListItemText 
                primary={source.name} 
                secondary={source.type} 
                sx={{ ml: 2, flexGrow: 1 }} 
              />
              <Chip label={`${source.pictureCount ?? 0} items`} size="small" sx={{ mx: 2 }} />
              
              <Box sx={{ display: 'flex', alignItems: 'center', minWidth: '150px', justifyContent: 'flex-end' }}>
                {source.type === 'local' && (
                  <Tooltip title={t('include_subfolders_tooltip')}>
                    <Checkbox
                      checked={!!source.includeSubfolders}
                      onChange={() => handleToggleSubfolders(source.id!, source.includeSubfolders ?? false)}
                      icon={<FolderZipIcon />}
                      checkedIcon={<FolderZipIcon />}
                    />
                  </Tooltip>
                )}
                
                {source.type === 'remote' && (
                  <>
                    <Tooltip title={t('sync_source_tooltip')}>
                      <IconButton aria-label="sync" onClick={() => onSync(source)}>
                        <SyncIcon />
                      </IconButton>
                    </Tooltip>
                    <Tooltip title={t('edit_source_tooltip')}>
                      <IconButton aria-label="edit" onClick={() => onEdit(source)}>
                        <EditIcon />
                      </IconButton>
                    </Tooltip>
                  </>
                )}
                
                <Tooltip title={t('delete_source_tooltip')}>
                  <IconButton aria-label="delete" onClick={() => handleDelete(source.id!)}>
                    <DeleteIcon />
                  </IconButton>
                </Tooltip>
              </Box>
            </Box>
          </ListItem>
        ))}
      </List>
      <Dialog
        open={dialogOpen}
        onClose={() => setDialogOpen(false)}
        aria-labelledby="alert-dialog-title"
        aria-describedby="alert-dialog-description"
      >
        <DialogTitle id="alert-dialog-title">
          {t('confirm_delete_source_title')}
        </DialogTitle>
        <DialogContent>
          <DialogContentText id="alert-dialog-description">
            {t('confirm_delete_source_message')}
          </DialogContentText>
        </DialogContent>
        <DialogActions>
          <Button onClick={() => setDialogOpen(false)}>{t('cancel_button')}</Button>
          <Button onClick={confirmDelete} autoFocus>
            {t('delete_button')}
          </Button>
        </DialogActions>
      </Dialog>
    </>
  );
}
