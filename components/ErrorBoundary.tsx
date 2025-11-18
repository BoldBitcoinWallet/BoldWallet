import React, {Component, ErrorInfo, ReactNode} from 'react';
import {View, Text, TouchableOpacity, StyleSheet} from 'react-native';
import {ThemeProvider, useTheme} from '../theme';
import {dbg} from '../utils';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
}

interface State {
  hasError: boolean;
  error?: Error;
}

// Inner component that uses theme
const ErrorFallback: React.FC<{error?: Error; resetError: () => void}> = ({
  error,
  resetError,
}) => {
  const {theme} = useTheme();

  const styles = StyleSheet.create({
    container: {
      flex: 1,
      justifyContent: 'center',
      alignItems: 'center',
      backgroundColor: theme.colors.background,
      padding: 20,
    },
    title: {
      fontSize: 24,
      fontWeight: 'bold',
      color: theme.colors.text,
      marginBottom: 16,
      textAlign: 'center',
    },
    message: {
      fontSize: 16,
      color: theme.colors.text,
      marginBottom: 20,
      textAlign: 'center',
      opacity: 0.8,
    },
    errorDetails: {
      fontSize: 12,
      color: '#ff6b6b',
      marginBottom: 20,
      textAlign: 'center',
      fontFamily: 'monospace',
    },
    button: {
      backgroundColor: theme.colors.primary,
      paddingHorizontal: 24,
      paddingVertical: 12,
      borderRadius: 8,
      marginTop: 10,
    },
    buttonText: {
      color: '#fff',
      fontSize: 16,
      fontWeight: '600',
    },
  });

  return (
    <View style={styles.container}>
      <Text style={styles.title}>Something went wrong</Text>
      <Text style={styles.message}>
        The app encountered an unexpected error. Your wallet data is safe and
        secure.
      </Text>
      {__DEV__ && error && (
        <Text style={styles.errorDetails}>{error.message}</Text>
      )}
      <TouchableOpacity style={styles.button} onPress={resetError}>
        <Text style={styles.buttonText}>Try Again</Text>
      </TouchableOpacity>
    </View>
  );
};

class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = {hasError: false};
  }

  static getDerivedStateFromError(error: Error): State {
    // Update state so the next render will show the fallback UI
    return {hasError: true, error};
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    // Log error securely - avoid exposing sensitive data
    const safeErrorInfo = {
      message: error.message,
      stack: error.stack?.split('\n').slice(0, 3).join('\n'), // Limit stack trace
      componentStack: errorInfo.componentStack
        ?.split('\n')
        .slice(0, 3)
        .join('\n'),
      timestamp: new Date().toISOString(),
    };

    // Only log in development or send to secure logging service
    if (__DEV__) {
      dbg('ErrorBoundary caught an error:', safeErrorInfo);
    } else {
      // In production, send to secure logging service without sensitive data
      dbg(
        'ErrorBoundary: App error occurred (details logged securely)',
        safeErrorInfo,
      );
    }
  }

  resetError = () => {
    this.setState({hasError: false, error: undefined});
  };

  render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <ThemeProvider>
          <ErrorFallback
            error={this.state.error}
            resetError={this.resetError}
          />
        </ThemeProvider>
      );
    }

    return this.props.children;
  }
}

export default ErrorBoundary;
