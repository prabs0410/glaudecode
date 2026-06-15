// Keep-awake (V5 Phase 5 / Story 5.3) — hold the machine awake while remote access is enabled, so a
// phone can always reach it ("leave it running, check from your pocket"). Built ONCE here as a
// cross-platform, ref-counted inhibitor with per-OS backends:
//   - macOS  : `caffeinate -dimsu` held as a child, killed on release (this phase).
//   - Linux  : `systemd-inhibit` — Phase 6 / Story 6.2 fills `spawn_inhibitor` for linux.
//   - other  : graceful no-op.
// Idempotent so toggling Serve vs the plain bind doesn't double-acquire. Default = held only while
// remote is enabled, released otherwise (the founder-decision default). Single-slot (one inhibitor
// child held at a time), NOT counted — acquire is idempotent rather than nesting.

use std::process::{Child, Command};
use std::sync::Mutex;

#[derive(Default)]
pub struct KeepAwake {
    inner: Mutex<Option<Child>>,
}

impl KeepAwake {
    /// Acquire the inhibitor. Returns Ok(true) when the machine is now held awake, Ok(false) when
    /// this OS has no backend (an expected no-op), or Err when a backend exists but failed to start —
    /// so a SILENT failure can't let the box sleep while remote is "on" (audit M19).
    pub fn acquire(&self) -> Result<bool, String> {
        let mut guard = self.inner.lock().unwrap();
        if guard.is_some() {
            return Ok(true); // already held (idempotent)
        }
        match spawn_inhibitor() {
            Ok(Some(child)) => {
                *guard = Some(child);
                Ok(true)
            }
            Ok(None) => Ok(false), // no backend on this OS — intentional no-op
            Err(e) => Err(e),
        }
    }

    /// Release the inhibitor (kills + REAPS the backend child). Safe to call when not held.
    pub fn release(&self) {
        if let Some(mut child) = self.inner.lock().unwrap().take() {
            let _ = child.kill();
            let _ = child.wait(); // reap — without this each toggle cycle leaks a zombie (audit L17)
        }
    }
}

#[cfg(target_os = "macos")]
fn spawn_inhibitor() -> Result<Option<Child>, String> {
    // -d display, -i idle, -m disk, -s system: prevent sleep; the assertion holds until the child dies.
    // caffeinate ships with macOS, so a spawn failure here is a real, report-worthy problem.
    Command::new("caffeinate")
        .arg("-dimsu")
        .spawn()
        .map(Some)
        .map_err(|e| format!("caffeinate failed to start: {e}"))
}

#[cfg(target_os = "linux")]
fn spawn_inhibitor() -> Result<Option<Child>, String> {
    // Hold a sleep+idle inhibitor lock for the lifetime of the child (killed on release). On a
    // non-systemd distro `systemd-inhibit` is absent → treat as an expected no-op (Ok(None)), not an
    // error, so we don't warn on every toggle there (V5 Phase 6.2.1).
    match Command::new("systemd-inhibit")
        .args([
            "--what=sleep:idle",
            "--why=GlaudeCode remote access",
            "--mode=block",
            "sleep",
            "infinity",
        ])
        .spawn()
    {
        Ok(child) => Ok(Some(child)),
        Err(_) => Ok(None), // absent / non-systemd → graceful no-op
    }
}

#[cfg(not(any(target_os = "macos", target_os = "linux")))]
fn spawn_inhibitor() -> Result<Option<Child>, String> {
    Ok(None) // other OSes (incl. native Windows): keep-awake is a graceful no-op
}
