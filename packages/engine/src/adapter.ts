// ClaudeCodeAdapter — the ONLY point in GlaudeCode that touches Claude Code.
// Constitution Principle XI: all Claude Code access goes through this adapter, via
// the supported Agent SDK APIs (never raw ~/.claude/projects JSONL parsing), so a
// change to Claude Code's interface touches exactly one file. Callers receive clean
// domain types (see ./types); SDK shapes never leak past here.

import {
  deleteSession as sdkDeleteSession,
  forkSession as sdkForkSession,
  getSessionInfo as sdkGetSessionInfo,
  getSessionMessages as sdkGetSessionMessages,
  listSessions as sdkListSessions,
  renameSession as sdkRenameSession,
  tagSession as sdkTagSession,
} from "@anthropic-ai/claude-agent-sdk";

import { mapSessionMessage, mapSessionSummary } from "./mappers";
import type { ForkResult, SessionMessage, SessionScope, SessionSummary } from "./types";

export interface ForkOptions {
  /** Slice the fork's transcript up to (and including) this message id. */
  upToMessageId?: string;
  /** Custom title for the fork. */
  title?: string;
}

export interface GetMessagesOptions {
  limit?: number;
  offset?: number;
  includeSystemMessages?: boolean;
}

export class ClaudeCodeAdapter {
  /** List sessions for a project directory, newest-relevant first (SDK order). */
  async listSessions(scope: SessionScope): Promise<SessionSummary[]> {
    const sessions = await sdkListSessions({ dir: scope.dir });
    return sessions.map(mapSessionSummary);
  }

  /** Metadata for a single session, or undefined if not found. */
  async getSessionInfo(id: string, scope: SessionScope): Promise<SessionSummary | undefined> {
    const info = await sdkGetSessionInfo(id, { dir: scope.dir });
    return info ? mapSessionSummary(info) : undefined;
  }

  /** Full message list for a session, mapped to domain blocks + usage. */
  async getSessionMessages(
    id: string,
    scope: SessionScope,
    opts: GetMessagesOptions = {},
  ): Promise<SessionMessage[]> {
    const msgs = await sdkGetSessionMessages(id, {
      dir: scope.dir,
      limit: opts.limit,
      offset: opts.offset,
      includeSystemMessages: opts.includeSystemMessages,
    });
    return msgs.map(mapSessionMessage);
  }

  /** Fork a session (non-destructive; original untouched). Returns the new id. */
  async forkSession(id: string, scope: SessionScope, opts: ForkOptions = {}): Promise<ForkResult> {
    const res = await sdkForkSession(id, {
      dir: scope.dir,
      upToMessageId: opts.upToMessageId,
      title: opts.title,
    });
    return { sessionId: res.sessionId };
  }

  async renameSession(id: string, title: string, scope: SessionScope): Promise<void> {
    await sdkRenameSession(id, title, { dir: scope.dir });
  }

  /** Set (string) or clear (null) a session's tag. */
  async tagSession(id: string, tag: string | null, scope: SessionScope): Promise<void> {
    await sdkTagSession(id, tag, { dir: scope.dir });
  }

  /** Permanently delete a session. */
  async deleteSession(id: string, scope: SessionScope): Promise<void> {
    await sdkDeleteSession(id, { dir: scope.dir });
  }
}
