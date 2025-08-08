import { Component, type ErrorInfo, type ReactNode } from 'react';
import Typography from '@mui/material/Typography';
import Box from '@mui/material/Box';

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  errorKey: number; // A key to force re-render
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    errorKey: 0,
  };

  public static getDerivedStateFromError(_: Error): State {
    // Update state so the next render will show the fallback UI.
    return { hasError: true, errorKey: 0 };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error("Uncaught error in child component:", error, errorInfo);
  }

  // This method allows us to recover from the error
  public componentDidUpdate(prevProps: Props) {
    if (this.state.hasError && prevProps.children !== this.props.children) {
      this.setState({ hasError: false });
    }
  }

  public render() {
    if (this.state.hasError) {
      return (
        <Box sx={{ p: 4, textAlign: 'center' }}>
          <Typography variant="h6">Recalculating Layout</Typography>
          <Typography color="text.secondary">The layout is being updated. Please wait a moment...</Typography>
        </Box>
      );
    }

    return this.props.children;
  }
}
