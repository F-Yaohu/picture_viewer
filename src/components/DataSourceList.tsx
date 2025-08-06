import { useEffect } from 'react';
import List from '@mui/material/List';
import ListItem from '@mui/material/ListItem';
import ListItemText from '@mui/material/ListItemText';
import Typography from '@mui/material/Typography';
import IconButton from '@mui/material/IconButton';
import Switch from '@mui/material/Switch';
import Checkbox from '@mui/material/Checkbox';
import DeleteIcon from '@mui/icons-material/Delete';
import FolderZipIcon from '@mui/icons-material/FolderZip';
import Tooltip from '@mui/material/Tooltip';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { useLiveQuery } from 'dexie-react-hooks';
import { useTranslation } from 'react-i18next';
import { db } from '../db/db';
import { imageUrlCache } from '../utils/imageUrlCache';

export default function DataSourceList() {
  const { t } = useTranslation();
  const dataSources = useLiveQuery(() => db.dataSources.toArray(), []);

  const handleDelete = async (id: number) => {
    if (window.confirm(t('confirm_delete_source'))) {
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
      } catch (error) {
        console.error('Failed to delete data source:', error);
      }
    }
  };

  const handleToggleEnabled = (id: number, currentStatus: number) => {
    db.dataSources.update(id, { enabled: currentStatus ? 0 : 1 });
  };

  const handleToggleSubfolders = (id: number, currentStatus: boolean) => {
    db.dataSources.update(id, { includeSubfolders: !currentStatus });
  };

  if (!dataSources) return <Typography>{t('loading')}</Typography>;
  if (dataSources.length === 0) {
    return <Typography align="center">{t('no_sources_added')}</Typography>;
  }

  return (
    <List>
      {dataSources.map((source) => (
        <ListItem
          key={source.id}
          secondaryAction={
            <IconButton edge="end" aria-label="delete" onClick={() => handleDelete(source.id!)}>
              <DeleteIcon />
            </IconButton>
          }
        >
          <Switch
            edge="start"
            checked={source.enabled === 1}
            onChange={() => handleToggleEnabled(source.id!, source.enabled)}
          />
          <ListItemText 
            primary={source.name} 
            secondary={source.type} 
            sx={{ ml: 2, mr: 2 }} 
          />
          <Chip label={`${source.pictureCount ?? 0} items`} size="small" sx={{ mr: 2 }} />
          {source.type === 'local' && (
            <Tooltip title={t('include_subfolders_tooltip')}>
              <Box sx={{ display: 'flex', alignItems: 'center' }}>
                <Checkbox
                  checked={!!source.includeSubfolders}
                  onChange={() => handleToggleSubfolders(source.id!, source.includeSubfolders ?? false)}
                />
                <FolderZipIcon />
              </Box>
            </Tooltip>
          )}
        </ListItem>
      ))}
    </List>
  );
}
