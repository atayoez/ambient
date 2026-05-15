// React error boundary so a crash in one tab doesn't take down the whole
// window. Each tab content is wrapped, keyed by tab id so switching tabs
// resets any captured error and re-mounts a clean tree.
import { Component, type ReactNode } from 'react';

interface Props {
  children: ReactNode;
}

interface State {
  error: Error | null;
}

export default class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: Error): State {
    return { error };
  }

  componentDidCatch(error: Error, info: { componentStack?: string | null }): void {
    // No telemetry yet — log to devtools so the message + stack are
    // available when the user reports it.
    console.error('Tab crashed:', error, info.componentStack);
  }

  reset = () => {
    this.setState({ error: null });
  };

  render(): ReactNode {
    if (this.state.error) {
      return (
        <div className="error-panel">
          <h2>Something went wrong</h2>
          <p className="muted">{this.state.error.message}</p>
          <button onClick={this.reset}>Try again</button>
        </div>
      );
    }
    return this.props.children;
  }
}
