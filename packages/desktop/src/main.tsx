import { Component, type ReactNode } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";

// Diagnostic error boundary (temporary, V4 verify): a render error was unmounting the whole
// app to a black screen with no visible cause. Surface the message + stack instead.
class ErrorBoundary extends Component<{ children: ReactNode }, { error: Error | null }> {
  state = { error: null as Error | null };
  static getDerivedStateFromError(error: Error) {
    return { error };
  }
  componentDidCatch(error: Error, info: unknown) {
    console.error("[glaudecode] render error", error, info);
  }
  render() {
    if (this.state.error) {
      return (
        <pre
          style={{
            color: "#f85149",
            background: "#0d1117",
            padding: 16,
            margin: 0,
            height: "100vh",
            overflow: "auto",
            font: "12px/1.5 ui-monospace, Menlo, monospace",
            whiteSpace: "pre-wrap",
          }}
        >
          {String(this.state.error?.message)}
          {"\n\n"}
          {String(this.state.error?.stack)}
        </pre>
      );
    }
    return this.props.children;
  }
}

// Also surface uncaught errors / promise rejections that escape React.
window.addEventListener("error", (e) => console.error("[glaudecode] window error", e.error ?? e.message));
window.addEventListener("unhandledrejection", (e) => console.error("[glaudecode] unhandledrejection", e.reason));

// NOTE: StrictMode intentionally omitted — its double-invoke of effects in dev
// would spawn two PTYs. Re-introduce with a spawn guard when the app grows.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(
  <ErrorBoundary>
    <App />
  </ErrorBoundary>,
);
