# docs/guides/ — How-to documentation

**Purpose**: Step-by-step instructions for accomplishing specific tasks. Two audiences:

- `user/` — end-user how-tos (install, configure, common workflows)
- `contributor/` — contributor how-tos (dev environment, testing, releasing, debugging)

**Naming**: `kebab-case-task.md`. Each file answers one question: "How do I X?"

**When to add a guide**:
- A user (or contributor) asks the same question twice — write the guide.
- A workflow has more than three steps and lives only in someone's head.
- A footgun exists that's not obvious from the code.

**What doesn't go here**:
- Conceptual explanations (architecture/ is the better home).
- API references (use `docs/api/`).
- Marketing copy (use `docs/marketing/`).

**Format**: open with the goal, list prerequisites, then numbered steps. Each step should
be copy-pasteable or self-contained.
