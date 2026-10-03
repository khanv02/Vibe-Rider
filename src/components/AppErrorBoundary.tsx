import { Component, type ErrorInfo, type ReactNode } from "react";

interface AppErrorBoundaryProps {
  children: ReactNode;
}

interface AppErrorBoundaryState {
  error: Error | null;
}

export class AppErrorBoundary extends Component<AppErrorBoundaryProps, AppErrorBoundaryState> {
  state: AppErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): AppErrorBoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error("Vibe Rider failed to render", error, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <main className="app-startup-error">
          <h1>Vibe Rider không thể hiển thị giao diện</h1>
          <p>{this.state.error.message}</p>
          <p>Hãy đóng app rồi chạy lại bằng <code>npm run tauri -- dev</code>.</p>
        </main>
      );
    }

    return this.props.children;
  }
}
