import { createTheme } from '@mui/material/styles';

// A lighter, fresher theme — soft pastels, rounded shapes and gentle shadows
const theme = createTheme({
  palette: {
    mode: 'light',
    primary: {
      main: '#4fc3f7', // soft cyan
      contrastText: '#04293a',
    },
    secondary: {
      main: '#ff8ab3', // soft pink accent
    },
    background: {
      default: '#f6fbff', // very light blue background for a fresh look
      paper: '#ffffff',
    },
    text: {
      primary: '#04293a',
      secondary: '#475569',
    },
  },
  shape: {
    borderRadius: 12,
  },
  components: {
    MuiCssBaseline: {
      styleOverrides: {
        body: {
          backgroundColor: '#f6fbff',
        },
      },
    },
    MuiAppBar: {
      styleOverrides: {
        root: {
          background: 'linear-gradient(90deg, rgba(79,195,247,0.12), rgba(255,138,179,0.06))',
          backdropFilter: 'blur(6px)',
          boxShadow: 'none',
        },
      },
    },
    MuiPaper: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          boxShadow: '0 6px 18px rgba(16,24,40,0.06)',
        },
      },
    },
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 12,
          overflow: 'hidden',
          boxShadow: '0 8px 24px rgba(16,24,40,0.06)'
        },
      },
    },
    MuiButton: {
      styleOverrides: {
        root: {
          borderRadius: 10,
          textTransform: 'none',
        },
      },
    },
    MuiIconButton: {
      styleOverrides: {
        root: {
          color: 'rgba(4,41,58,0.85)'
        }
      }
    }
  },
});

export default theme;
