import * as Sentry from '@sentry/react-native';
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { RootErrorFallback } from './RootErrorFallback';

interface State {
  hasError: boolean;
}

/** Top-level error boundary — reports to Sentry and shows a recoverable fallback. */
export class RootErrorBoundary extends Component<
  { children: ReactNode },
  State
> {
  state: State = { hasError: false };

  static getDerivedStateFromError(): State {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    Sentry.captureException(error, {
      extra: { componentStack: info.componentStack },
    });
  }

  reset = () => this.setState({ hasError: false });

  render() {
    if (this.state.hasError) {
      return <RootErrorFallback onReset={this.reset} />;
    }
    return this.props.children;
  }
}
