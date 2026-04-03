import React from 'react';

/** Disables heavy particle animation if rendering fails on low-end devices. */
export class ParticlesErrorBoundary extends React.Component<
  {onError: () => void; children: React.ReactNode},
  {hasError: boolean}
> {
  state = {hasError: false};

  static getDerivedStateFromError() {
    return {hasError: true};
  }

  componentDidCatch() {
    this.props.onError();
  }

  render() {
    if (this.state.hasError) {
      return null;
    }
    return this.props.children;
  }
}
