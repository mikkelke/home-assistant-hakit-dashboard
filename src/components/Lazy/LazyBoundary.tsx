import { Component, Suspense, type ReactNode } from 'react';

interface LazyBoundaryProps {
  /** Shown while the chunk loads. */
  fallback: ReactNode;
  /** Shown instead of the children when the chunk fails to load or they throw while rendering. */
  error: ReactNode;
  children: ReactNode;
}

interface LazyBoundaryState {
  failed: boolean;
}

/** Suspense for a lazily loaded chunk that degrades to `error` rather than unmounting the app. */
export class LazyBoundary extends Component<LazyBoundaryProps, LazyBoundaryState> {
  state: LazyBoundaryState = { failed: false };

  static getDerivedStateFromError(): LazyBoundaryState {
    return { failed: true };
  }

  render() {
    if (this.state.failed) return this.props.error;
    return <Suspense fallback={this.props.fallback}>{this.props.children}</Suspense>;
  }
}
