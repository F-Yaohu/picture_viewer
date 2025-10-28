import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import IconButton from '@mui/material/IconButton';
import Menu from '@mui/material/Menu';
import MenuItem from '@mui/material/MenuItem';
import MoreHorizIcon from '@mui/icons-material/MoreHoriz';
import { useTranslation } from 'react-i18next';
import type { DataSource } from '../db/db';
import { useState } from 'react';

interface FilterChipsProps {
  allSources: DataSource[];
  selectedSourceId: number | 'all';
  onSourceChange: (sourceId: number | 'all') => void;
}

export default function FilterChips({ allSources, selectedSourceId, onSourceChange }: FilterChipsProps) {
  const { t } = useTranslation();
  const [anchorEl, setAnchorEl] = useState<null | HTMLElement>(null);
  const open = Boolean(anchorEl);
  const handleOpenMenu = (e: React.MouseEvent<HTMLElement>) => setAnchorEl(e.currentTarget);
  const handleCloseMenu = () => setAnchorEl(null);
  // Filter for enabled sources directly from the passed prop
  const enabledDataSources = allSources.filter(source => source.enabled === 1 || source.type === 'server');
  // We only show the filter if there is more than one *enabled* or server source.
  if (enabledDataSources.length <= 1) {
    return null;
  }

  // When there are many sources, show first N and put the rest into a "More" menu
  const MAX_VISIBLE = 7;
  const visible = enabledDataSources.slice(0, MAX_VISIBLE);
  const hidden = enabledDataSources.slice(MAX_VISIBLE);

  return (
    <Stack direction="row" spacing={1} sx={{ mb: 2, justifyContent: 'center', overflowX: 'auto', py: 1 }}>
      <Chip
        label={t('all_sources')}
        clickable
        color={selectedSourceId === 'all' ? 'primary' : 'default'}
        onClick={() => onSourceChange('all')}
      />
      {visible.map((source) => (
        <Chip
          key={source.id}
          label={source.name}
          clickable
          color={selectedSourceId === source.id ? 'primary' : 'default'}
          onClick={() => onSourceChange(source.id!)}
        />
      ))}
      {hidden.length > 0 && (
        <>
          <IconButton size="small" onClick={handleOpenMenu} aria-label="more-sources">
            <MoreHorizIcon />
          </IconButton>
          <Menu anchorEl={anchorEl} open={open} onClose={handleCloseMenu}>
            {hidden.map(s => (
              <MenuItem key={s.id} onClick={() => { onSourceChange(s.id!); handleCloseMenu(); }}>
                {s.name}
              </MenuItem>
            ))}
          </Menu>
        </>
      )}
    </Stack>
  );
}
