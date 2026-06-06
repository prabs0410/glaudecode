import ReactDOM from "react-dom/client";
import App from "./App";

// NOTE: StrictMode intentionally omitted — its double-invoke of effects in dev
// would spawn two PTYs. Re-introduce with a spawn guard when the app grows.
ReactDOM.createRoot(document.getElementById("root") as HTMLElement).render(<App />);
