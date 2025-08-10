import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import { useTranslation } from 'react-i18next';
import type { DataSource } from '../db/db';

interface FilterChipsProps {
  allSources: DataSource[];
  selectedSourceId: number | 'all';
  onSourceChange: (sourceId: number | 'all') => void;
}

export default function FilterChips({ allSources, selectedSourceId, onSourceChange }: FilterChipsProps) {
  const { t } = useTranslation();
  // Filter for enabled sources directly from the passed prop
  const enabledDataSources = allSources.filter(source => source.enabled === 1 || source.type === 'server');

  // We only show the filter if there is more than one *enabled* or server source.
  if (enabledDataSources.length <= 1) {
    return null;
  }

  return (
    <Stack direction="row" spacing={1} sx={{ mb: 2, justifyContent: 'center' }}>
      <Chip
        label={t('all_sources')}
        clickable
        color={selectedSourceId === 'all' ? 'primary' : 'default'}
        onClick={() => onSourceChange('all')}
      />
      {enabledDataSources.map((source) => (
        <Chip
          key={source.id}
          label={source.name}
          clickable
          color={selectedSourceId === source.id ? 'primary' : 'default'}
          onClick={() => onSourceChange(source.id!)}
        />
      ))}
    </Stack>
  );
}
