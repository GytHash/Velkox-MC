import React from 'react';

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends React.Component<
  { children: React.ReactNode },
  ErrorBoundaryState
> {
  constructor(props: { children: React.ReactNode }) {
    super(props);
    this.state = { hasError: false, message: '' };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    let message = error.message || 'An unexpected error occurred.';
    try {
      const parsed = JSON.parse(error.message);
      if (parsed && typeof parsed.error === 'string') {
        message = parsed.error;
      }
    } catch {
      // keep raw message
    }
    return { hasError: true, message };
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen mc-deepslate-bg flex items-center justify-center p-6">
          <div className="mc-panel max-w-lg w-full p-6 space-y-4">
            <h1 className="font-pixel text-xl text-[#FF5555]">
              Connection Interrupted
            </h1>
            <p className="text-sm text-[#C7CDD6] leading-relaxed">
              Velkox VC ran into an error while syncing your session.
            </p>
            <div className="mc-slot p-3 text-xs font-mono-tabular text-[#D9DCE3] break-words">
              {this.state.message}
            </div>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="mc-btn-emerald px-5 py-2.5 font-pixel text-sm cursor-pointer"
            >
              Reconnect Client
            </button>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}
