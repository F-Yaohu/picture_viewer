import { useState } from 'react';
import { Alert, Button, Snackbar, AlertTitle, List, ListItem, ListItemText, Paper, Typography, Box } from '@mui/material';
import { useTranslation } from 'react-i18next';
import { verifyHandlePermission } from '../utils/permissionUtils';
import type { DataSource } from '../db/db';

interface PermissionManagerProps {
  sourcesToVerify: DataSource[];
  onVerificationComplete: () => void;
}

export default function PermissionManager({ sourcesToVerify, onVerificationComplete }: PermissionManagerProps) {
  const { t } = useTranslation();
  const [isVerifying, setIsVerifying] = useState(false);
  const [open, setOpen] = useState(true);

  const handleGrantPermission = async () => {
    setIsVerifying(true);
    let allGranted = true;
    for (const source of sourcesToVerify) {
      const handle = source.path as unknown as FileSystemDirectoryHandle;
      const granted = await verifyHandlePermission(handle, false);
      if (!granted) {
        allGranted = false;
        // Optional: notify user that this specific source failed
        console.warn(`Permission denied for source: ${source.name}`);
      }
    }
    setIsVerifying(false);
    if (allGranted) {
      setOpen(false);
      onVerificationComplete();
    } else {
      // Handle cases where not all permissions were granted
      alert(t('permission_partially_denied'));
    }
  };

  if (!sourcesToVerify.length || !open) {
    return null;
  }

  return (
    <Snackbar open={open} anchorOrigin={{ vertical: 'bottom', horizontal: 'center' }} sx={{ width: '100%', display: 'flex', justifyContent: 'center' }}>
      <Paper elevation={6} sx={{ p: 2, width: 'clamp(300px, 60%, 800px)' }}>
        <Alert severity="warning" variant="outlined" sx={{ border: 'none' }}>
          <AlertTitle>{t('permission_required_title')}</AlertTitle>
          <Typography variant="body2" sx={{ mb: 2 }}>
            {t('permission_required_desc', { count: sourcesToVerify.length })}
          </Typography>
          <Box sx={{ maxHeight: 150, overflowY: 'auto', mb: 2, border: '1px solid rgba(0, 0, 0, 0.1)', borderRadius: 1, p: 1 }}>
            <List dense>
              {sourcesToVerify.map(source => (
                <ListItem key={source.id}>
                  <ListItemText primary={source.name} />
                </ListItem>
              ))}
            </List>
          </Box>
          <Button
            color="warning"
            variant="contained"
            onClick={handleGrantPermission}
            disabled={isVerifying}
          >
            {isVerifying ? t('permission_granting') : t('permission_grant_button')}
          </Button>
        </Alert>
      </Paper>
    </Snackbar>
  );
}
