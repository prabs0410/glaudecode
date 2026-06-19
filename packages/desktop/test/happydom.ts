// Preloaded before the desktop test suite (see bunfig.toml [test].preload) to register a DOM into the
// Bun test runtime, so React component tests for the safety surface (arm/kill/consent) can render and
// be driven with @testing-library/react. We deliberately reuse Bun's own test runner rather than add a
// second one (vitest) — one runner for the whole repo (founder decision, 2026-06-19). #20
import { GlobalRegistrator } from "@happy-dom/global-registrator";

GlobalRegistrator.register();
