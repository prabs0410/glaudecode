# docs/marketing/ — Build-in-public artifacts

**Purpose**: Versioned artifacts that support GlaudeCode's public narrative. Heartbeat post
archives (per Constitution Principle VII), blog drafts, launch posts, demo scripts,
dev-log content.

**Not in scope**: the website source itself (lives in its own repo or its own deploy
target), social-media post content that's purely ephemeral, slide decks for one-off talks.

**Naming**:
- Heartbeats: `heartbeats/YYYY-MM-DD-headline-slug.md` (subfolder created when the first
  heartbeat lands)
- Blog drafts: `blog/YYYY-MM-DD-title-slug.md`
- Launch posts: `launches/vX.Y.Z-channel.md` (e.g., `v0.1.0-show-hn.md`)
- Demo scripts: `demos/topic-kebab-case.md`

**Heartbeat archive**: every Friday heartbeat post that contains substantive content (more
than a tag link) MUST be archived here in the same commit that publishes it. Tag-only
heartbeats need no archive.
