import { useSelector } from 'react-redux';
import Box from '@mui/material/Box';
import Chip from '@mui/material/Chip';
import { useTranslation } from 'react-i18next';
import type { RootState } from '../store/store';

interface FilterChipsProps {
  activeFilter: number;
  onFilterChange: (id: number) => void;
}

export default function FilterChips({ activeFilter, onFilterChange }: FilterChipsProps) {
  const { t } = useTranslation();
  const dataSources = useSelector((state: RootState) => state.dataSources.sources);

  return (
    <Box sx={{ mb: 2, display: 'flex', flexWrap: 'wrap', gap: 1 }}>
      <Chip
        label={t('all_sources')}
        clickable
        onClick={() => onFilterChange(-1)}
        variant={activeFilter === -1 ? 'filled' : 'outlined'}
        color="primary"
      />
      {dataSources.map(source => (
        <Chip
          key={source.id}
          label={source.name}
          clickable
          onClick={() => onFilterChange(source.id!)}
          variant={activeFilter === source.id ? 'filled' : 'outlined'}
        />
      ))}
    </Box>
  );
}
