// Keep-awake (V5 Phase 5 / Story 5.3) — hold the machine awake while remote access is enabled, so a
// phone can always reach it ("leave it running, check from your pocket"). Built ONCE here as a
// cross-platform, ref-counted inhibitor with per-OS backends:
//   - macOS  : `caffeinate -dimsu` held as a child, killed on release (this phase).
//   - Linux  : `systemd-inhibit` — Phase 6 / Story 6.2 fills `spawn_inhibitor` for linux.
//   - other  : graceful no-op.
// Idempotent so toggling Serve vs the plain bind doesn't double-acquire. Default = held only while
// remote is enabled, released otherwise (the founder-decision default).

use std::process::{Child, Command};
use std::sync::Mutex;

#[derive(Default)]
pub struct KeepAwake {
    inner: Mutex<Option<Child>>,
}

impl KeepAwake {
    /// Acquire the inhibitor (no-op if already held, or if the OS backend is a no-op).
    pub fn acquire(&self) {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() {
            return;
        }
        *guard = spawn_inhibitor();
    }

    /// Release the inhibitor (kills the backend child). Safe to call when not held.
    pub fn release(&self) {
        if let Some(mut child) = self.inner.lock().unwrap().take() {
            let _ = child.kill();
        }
    }
}

#[cfg(target_os = "macos")]
fn spawn_inhibitor() -> Option<Child> {
    // -d display, -i idle, -m disk, -s system: prevent sleep; the assertion holds until the child dies.
    Command::new("caffeinate").arg("-dimsu").spawn().ok()
}

#[cfg(not(target_os = "macos"))]
fn spawn_inhibitor() -> Option<Child> {
    // Linux `systemd-inhibit` backend is added in Phase 6 / Story 6.2 behind this same interface;
    // until then (and on other OSes) keep-awake is a graceful no-op.
    None
}
