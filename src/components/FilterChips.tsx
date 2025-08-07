import { useSelector } from 'react-redux';
import Chip from '@mui/material/Chip';
import Stack from '@mui/material/Stack';
import { useTranslation } from 'react-i18next';
import type { RootState } from '../store/store';

interface FilterChipsProps {
  selectedSourceId: number | 'all';
  onSourceChange: (sourceId: number | 'all') => void;
}

export default function FilterChips({ selectedSourceId, onSourceChange }: FilterChipsProps) {
  const { t } = useTranslation();
  const allDataSources = useSelector((state: RootState) => state.dataSources.sources);
  const enabledDataSources = allDataSources.filter(source => source.enabled === 1);

  // We only show the filter if there is more than one *enabled* source.
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