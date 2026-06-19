// Component tests for the desktop SAFETY surface (audit #20 — "the single most important fix"): the
// kill switch and the pairing consent gates were the highest-risk UI and had ZERO tests, so a
// kill-switch no-op or a consent bypass would ship green. Rendered with @testing-library/react under
// Bun's runner + happy-dom (see bunfig.toml / test/happydom.ts). The engine RPC wrappers and the Tauri
// bridge are mocked, so these assert the COMPONENT'S behaviour (does the click call disarm? is a
// terminal code refused until consent?) without a live engine.
import { afterEach, beforeEach, describe, expect, mock, test } from "bun:test";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";

// --- mutable mock state (reset per test) ---
let armedRet: string[] = [];
let remoteRet: { enabled: boolean } = { enabled: false };
let disarmImpl: () => Promise<void> = async () => {};
let armedChangedCb: ((e: { payload: string[] }) => void) | null = null;

// --- engine RPC wrapper mocks (comprehensive superset for both components) ---
const disarmAllPanes = mock(() => disarmImpl());
const listArmed = mock(async () => armedRet);
const remoteStatus = mock(async () => remoteRet);
const createPairCode = mock(async (scope: string) => ({ code: "ABC123", scope, expiresAt: 1_700_000_000_000 }));
const listDevices = mock(async () => [] as unknown[]);
const engineEndpoint = mock(async () => ({ port: 5173 }));
const disableRemote = mock(async () => ({ enabled: false }));
const enableRemote = mock(async () => ({ enabled: true }));
const revokeDevice = mock(async () => {});

// --- Tauri bridge mocks ---
const listen = mock(async (_ev: string, cb: (e: { payload: string[] }) => void) => {
  armedChangedCb = cb;
  return () => {};
});
const invoke = mock(async (_cmd: string) => null);

mock.module("../src/engine", () => ({
  disarmAllPanes,
  listArmed,
  remoteStatus,
  createPairCode,
  listDevices,
  engineEndpoint,
  disableRemote,
  enableRemote,
  revokeDevice,
}));
mock.module("@tauri-apps/api/event", () => ({ listen }));
mock.module("@tauri-apps/api/core", () => ({ invoke }));

// Import the components AFTER the mocks are registered (top-level await so the static `./engine` /
// tauri imports inside them resolve to the mocks above).
const { RemoteArmedChips } = await import("../src/RemoteArmedChips");
const { PairingModal } = await import("../src/PairingModal");

beforeEach(() => {
  armedRet = [];
  remoteRet = { enabled: false };
  disarmImpl = async () => {};
  armedChangedCb = null;
  localStorage.clear();
  for (const m of [disarmAllPanes, listArmed, remoteStatus, createPairCode, listDevices, engineEndpoint, listen, invoke]) {
    m.mockClear();
  }
});
afterEach(() => cleanup());

describe("RemoteArmedChips — the always-reachable kill switch (audit M4/M14/H2)", () => {
  test("the kill switch calls disarmAllPanes and clears the armed chips", async () => {
    armedRet = ["p1", "p2"];
    remoteRet = { enabled: true };
    render(<RemoteArmedChips />);
    const killBtn = await screen.findByRole("button", { name: /disarm all/i });
    expect(screen.getByText(/ARMED ×2/)).toBeTruthy();

    fireEvent.click(killBtn);

    await waitFor(() => expect(disarmAllPanes).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.queryByText(/ARMED ×/)).toBeNull());
  });

  test("a FAILED disarm surfaces an error instead of faking success (audit M4)", async () => {
    armedRet = ["p1"];
    remoteRet = { enabled: true };
    disarmImpl = async () => {
      throw new Error("rust core unreachable");
    };
    render(<RemoteArmedChips />);
    const killBtn = await screen.findByRole("button", { name: /disarm all/i });

    fireEvent.click(killBtn);

    // The component must NOT clear the armed state on failure — it shows the panes may still be armed.
    await waitFor(() => expect(screen.getByText(/disarm failed/i)).toBeTruthy());
    expect(disarmAllPanes).toHaveBeenCalledTimes(1);
  });

  test("the armed count follows the AUTHORITATIVE armed-changed event, never desyncs (audit H2)", async () => {
    armedRet = ["p1"];
    remoteRet = { enabled: false }; // only the armed chip should show
    render(<RemoteArmedChips />);
    expect(await screen.findByText(/ARMED ×1/)).toBeTruthy();

    // The Rust core broadcasts a new authoritative armed set — the chip must follow it.
    act(() => armedChangedCb?.({ payload: ["p1", "p2", "p3"] }));
    await waitFor(() => expect(screen.getByText(/ARMED ×3/)).toBeTruthy());
  });
});

describe("PairingModal — terminal-scope consent gate (audit M8)", () => {
  test("a TERMINAL pairing code is NOT minted until the explicit per-mint consent is accepted", async () => {
    render(<PairingModal onClose={() => {}} />);
    const select = await screen.findByRole("combobox");
    fireEvent.change(select, { target: { value: "terminal" } });

    // Clicking Generate with terminal scope must show the consent and mint NOTHING.
    fireEvent.click(screen.getByRole("button", { name: /^generate code$/i }));
    await waitFor(() => expect(screen.getByText(/about to mint a/i)).toBeTruthy());
    expect(createPairCode).not.toHaveBeenCalled();

    // Accepting the consent is what actually mints — and it mints TERMINAL scope.
    fireEvent.click(screen.getByRole("button", { name: /generate terminal code/i }));
    await waitFor(() => expect(createPairCode).toHaveBeenCalledTimes(1));
    expect(createPairCode).toHaveBeenLastCalledWith("terminal");
  });

  test("cancelling the terminal consent mints nothing", async () => {
    render(<PairingModal onClose={() => {}} />);
    fireEvent.change(await screen.findByRole("combobox"), { target: { value: "terminal" } });
    fireEvent.click(screen.getByRole("button", { name: /^generate code$/i }));
    await waitFor(() => expect(screen.getByText(/about to mint a/i)).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: /^cancel$/i }));
    expect(createPairCode).not.toHaveBeenCalled();
  });
});
