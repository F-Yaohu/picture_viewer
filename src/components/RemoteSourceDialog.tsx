import { useState, useEffect } from 'react';
import Dialog from '@mui/material/Dialog';
import DialogTitle from '@mui/material/DialogTitle';
import DialogContent from '@mui/material/DialogContent';
import DialogActions from '@mui/material/DialogActions';
import Button from '@mui/material/Button';
import TextField from '@mui/material/TextField';
import Box from '@mui/material/Box';
import InputLabel from '@mui/material/InputLabel';
import MenuItem from '@mui/material/MenuItem';
import FormControl from '@mui/material/FormControl';
import Select from '@mui/material/Select';
import Typography from '@mui/material/Typography';
import Paper from '@mui/material/Paper';
import IconButton from '@mui/material/IconButton';
import AddIcon from '@mui/icons-material/Add';
import DeleteIcon from '@mui/icons-material/Delete';
import { useTranslation } from 'react-i18next';
import { db, type DataSource, type RemoteConfig } from '../db/db';

interface RemoteSourceDialogProps {
  open: boolean;
  onClose: () => void;
  dataSource?: DataSource; // For editing existing source
}

const emptyConfig: RemoteConfig = {
  url: '',
  method: 'GET',
  headers: {},
  body: '{}', // Store body as a JSON string
  responsePath: '',
  fieldMapping: { url: '', name: '' },
};

export default function RemoteSourceDialog({ open, onClose, dataSource }: RemoteSourceDialogProps) {
  const { t } = useTranslation();
  const [name, setName] = useState('');
  const [config, setConfig] = useState<RemoteConfig>(emptyConfig);
  const [parameterPairs, setParameterPairs] = useState<{ key: string, value: string }[]>([]);

  useEffect(() => {
    if (dataSource) {
      setName(dataSource.name);
      const currentConfig = dataSource.remoteConfig || emptyConfig;
      setConfig(currentConfig);
      try {
        // For GET, we might need to parse params from URL, but for simplicity, we assume they are stored in body for editing.
        const paramObj = JSON.parse(currentConfig.body || '{}');
        setParameterPairs(Object.entries(paramObj).map(([key, value]) => ({ key, value: String(value) })));
      } catch {
        setParameterPairs([]);
      }
    } else {
      setName('');
      setConfig(emptyConfig);
      setParameterPairs([]);
    }
  }, [dataSource, open]);

  // Update config.body whenever parameterPairs changes, as it's used for both GET (reconstructed to query) and POST
  useEffect(() => {
    const paramObj = parameterPairs.reduce((acc, pair) => {
      if (pair.key) acc[pair.key] = pair.value;
      return acc;
    }, {} as Record<string, any>);
    setConfig(prev => ({ ...prev, body: JSON.stringify(paramObj) }));
  }, [parameterPairs]);

  const handleConfigChange = (field: keyof RemoteConfig, value: any) => {
    setConfig(prev => ({ ...prev, [field]: value }));
  };

  const handleFieldMappingChange = (field: keyof RemoteConfig['fieldMapping'], value: string) => {
    setConfig(prev => ({
      ...prev,
      fieldMapping: { ...prev.fieldMapping, [field]: value },
    }));
  };

  const handleHeaderChange = (key: string, value: string) => {
    setConfig(prev => ({ ...prev, headers: { ...prev.headers, [key]: value } }));
  };

  const addHeader = () => {
    setConfig(prev => ({ ...prev, headers: { ...prev.headers, '': '' } }));
  };

  const removeHeader = (key: string) => {
    const newHeaders = { ...config.headers };
    delete newHeaders[key];
    setConfig(prev => ({ ...prev, headers: newHeaders }));
  };

  const handleParameterPairChange = (index: number, field: 'key' | 'value', value: string) => {
    const newPairs = [...parameterPairs];
    newPairs[index][field] = value;
    setParameterPairs(newPairs);
  };

  const addParameterPair = () => {
    setParameterPairs(prev => [...prev, { key: '', value: '' }]);
  };

  const removeParameterPair = (index: number) => {
    setParameterPairs(prev => prev.filter((_, i) => i !== index));
  };


  const handleSave = async () => {
    if (!name || !config.url || !config.fieldMapping.url || !config.fieldMapping.name) {
      alert(t('required_fields_missing'));
      return;
    }

    const sourceData: Omit<DataSource, 'id'> = {
      name,
      type: 'remote',
      enabled: 1,
      path: config.url, // Store base URL as path for simplicity
      remoteConfig: config,
    };

    try {
      if (dataSource?.id) {
        // Update existing source
        await db.dataSources.update(dataSource.id, sourceData);
      } else {
        // Add new source
        await db.dataSources.add(sourceData as DataSource);
      }
      onClose();
    } catch (error) {
      console.error("Failed to save data source:", error);
      alert(t('save_error_message'));
    }
  };

  return (
    <Dialog open={open} onClose={onClose} fullWidth maxWidth="md">
      <DialogTitle>{dataSource ? t('edit_remote_source_title') : t('add_remote_source_title')}</DialogTitle>
      <DialogContent dividers>
        <TextField
          autoFocus
          margin="dense"
          id="name"
          label={t('source_name_label')}
          type="text"
          fullWidth
          variant="outlined"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <Box sx={{ display: 'flex', gap: 2, mt: 2 }}>
          <TextField
            margin="dense"
            id="url"
            label={t('api_url_label')}
            type="url"
            fullWidth
            variant="outlined"
            value={config.url}
            onChange={(e) => handleConfigChange('url', e.target.value)}
            helperText={t('pagination_helper')}
          />
          <FormControl margin="dense" sx={{ minWidth: 120 }}>
            <InputLabel id="method-select-label">{t('method_label')}</InputLabel>
            <Select
              labelId="method-select-label"
              id="method-select"
              value={config.method}
              label={t('method_label')}
              onChange={(e) => handleConfigChange('method', e.target.value)}
            >
              <MenuItem value="GET">GET</MenuItem>
              <MenuItem value="POST">POST</MenuItem>
            </Select>
          </FormControl>
        </Box>

        <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
          <Typography variant="h6" gutterBottom>{t('request_config_title')}</Typography>
          
          <Typography variant="subtitle1" sx={{ mt: 2 }}>{t('headers_title')}</Typography>
          {Object.entries(config.headers).map(([key, value]) => (
            <Box key={key} sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <TextField margin="dense" label={t('header_key_label')} defaultValue={key} variant="outlined" sx={{ flex: 1 }} onBlur={(e) => {
                  const newKey = e.target.value;
                  if (newKey !== key) {
                    const newHeaders = { ...config.headers };
                    delete newHeaders[key];
                    newHeaders[newKey] = value;
                    setConfig(prev => ({ ...prev, headers: newHeaders }));
                  }
                }}
              />
              <TextField margin="dense" label={t('header_value_label')} value={value} variant="outlined" sx={{ flex: 1 }} onChange={(e) => handleHeaderChange(key, e.target.value)} />
              <IconButton onClick={() => removeHeader(key)}><DeleteIcon /></IconButton>
            </Box>
          ))}
          <Button startIcon={<AddIcon />} onClick={addHeader} sx={{ mt: 1 }}>{t('add_header_button')}</Button>

          <Typography variant="subtitle1" sx={{ mt: 2 }}>{t('parameters_title')}</Typography>
          <Typography variant="body2" color="text.secondary">{t('parameters_helper')}</Typography>
          {parameterPairs.map((pair, index) => (
            <Box key={index} sx={{ display: 'flex', gap: 2, alignItems: 'center' }}>
              <TextField margin="dense" label={t('param_key_label')} value={pair.key} variant="outlined" sx={{ flex: 1 }} onChange={(e) => handleParameterPairChange(index, 'key', e.target.value)} />
              <TextField margin="dense" label={t('param_value_label')} value={pair.value} variant="outlined" sx={{ flex: 1 }} onChange={(e) => handleParameterPairChange(index, 'value', e.target.value)} />
              <IconButton onClick={() => removeParameterPair(index)}><DeleteIcon /></IconButton>
            </Box>
          ))}
          <Button startIcon={<AddIcon />} onClick={addParameterPair} sx={{ mt: 1 }}>{t('add_parameter_button')}</Button>
        </Paper>

        <Paper variant="outlined" sx={{ p: 2, mt: 3 }}>
          <Typography variant="h6" gutterBottom>{t('response_parsing_title')}</Typography>
          <TextField
            margin="dense"
            id="maxImages"
            label={t('max_images_label')}
            type="number"
            fullWidth
            variant="outlined"
            value={config.maxImages || ''}
            onChange={(e) => handleConfigChange('maxImages', e.target.value ? parseInt(e.target.value, 10) : undefined)}
            helperText={t('max_images_helper')}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            id="baseURL"
            label={t('base_url_label')}
            type="url"
            fullWidth
            variant="outlined"
            value={config.baseURL || ''}
            onChange={(e) => handleConfigChange('baseURL', e.target.value)}
            helperText={t('base_url_helper')}
            sx={{ mb: 2 }}
          />
          <TextField
            margin="dense"
            id="responsePath"
            label={t('response_path_label')}
            helperText={t('response_path_helper')}
            fullWidth
            variant="outlined"
            value={config.responsePath}
            onChange={(e) => handleConfigChange('responsePath', e.target.value)}
          />
          <Typography variant="subtitle1" sx={{ mt: 2 }}>{t('field_mapping_title')}</Typography>
          <Box sx={{ display: 'flex', gap: 2, mt: 1 }}>
            <TextField
              margin="dense"
              id="map-url"
              label={t('field_map_url_label')}
              helperText={t('field_map_url_helper')}
              fullWidth
              variant="outlined"
              value={config.fieldMapping.url}
              onChange={(e) => handleFieldMappingChange('url', e.target.value)}
            />
            <TextField
              margin="dense"
              id="map-name"
              label={t('field_map_name_label')}
              helperText={t('field_map_name_helper')}
              fullWidth
              variant="outlined"
              value={config.fieldMapping.name}
              onChange={(e) => handleFieldMappingChange('name', e.target.value)}
            />
            <TextField
              margin="dense"
              id="map-modified"
              label={t('field_map_modified_label')}
              helperText={t('field_map_modified_helper')}
              fullWidth
              variant="outlined"
              value={config.fieldMapping.modified}
              onChange={(e) => handleFieldMappingChange('modified', e.target.value)}
            />
          </Box>
        </Paper>

      </DialogContent>
      <DialogActions>
        <Button onClick={onClose}>{t('cancel_button')}</Button>
        <Button onClick={handleSave}>{t('save_button')}</Button>
      </DialogActions>
    </Dialog>
  );
}
