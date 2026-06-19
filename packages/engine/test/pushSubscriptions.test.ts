import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PushSubscriptionStore, parsePushSubscription, wouldDeliverPush } from "../src/pushSubscriptions";

const tmps: string[] = [];
const home = () => {
  const d = mkdtempSync(join(tmpdir(), "gc-push-"));
  tmps.push(d);
  return d;
};
afterEach(() => {
  for (const d of tmps.splice(0)) rmSync(d, { recursive: true, force: true });
});

const sub = (n = 1): any => ({ endpoint: `https://push.example/${n}`, keys: { p256dh: "BPxx", auth: "aXx" } });

describe("parsePushSubscription (untrusted body)", () => {
  test("accepts a well-formed https subscription", () => {
    const s = parsePushSubscription({ endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" }, expirationTime: 123 });
    expect(s).toEqual({ endpoint: "https://push.example/abc", keys: { p256dh: "k", auth: "a" }, expirationTime: 123 });
  });
  test("rejects non-https, missing keys, oversize, and junk", () => {
    expect(parsePushSubscription({ endpoint: "http://insecure/x", keys: { p256dh: "k", auth: "a" } })).toBeNull();
    expect(parsePushSubscription({ endpoint: "https://x", keys: { p256dh: "k" } })).toBeNull();
    expect(parsePushSubscription({ endpoint: "https://x", keys: { p256dh: "z".repeat(300), auth: "a" } })).toBeNull();
    expect(parsePushSubscription(null)).toBeNull();
    expect(parsePushSubscription("nope")).toBeNull();
  });
});

describe("PushSubscriptionStore (persisted, per-device)", () => {
  test("add upserts per device and persists across instances", () => {
    const h = home();
    new PushSubscriptionStore(h).add("d1", sub(1), "t0");
    expect(new PushSubscriptionStore(h).count()).toBe(1);
    // re-subscribing the same device REPLACES (no duplicate)
    new PushSubscriptionStore(h).add("d1", sub(2), "t1");
    const list = new PushSubscriptionStore(h).list();
    expect(list).toHaveLength(1);
    expect(list[0].sub.endpoint).toBe("https://push.example/2");
  });

  test("a second device adds a second subscription; remove drops one", () => {
    const h = home();
    const store = new PushSubscriptionStore(h);
    store.add("d1", sub(1), "t0");
    store.add("d2", sub(2), "t0");
    expect(store.count()).toBe(2);
    expect(store.remove("d1")).toBe(true);
    expect(store.remove("d1")).toBe(false); // already gone
    expect(store.count()).toBe(1);
  });

  test("the store file is written 0600", () => {
    const h = home();
    new PushSubscriptionStore(h).add("d1", sub(), "t0");
    const mode = statSync(join(h, ".glaudecode", "push-subscriptions.json")).mode & 0o077;
    expect(mode).toBe(0);
  });

  test("a missing store reads as empty (no crash)", () => {
    expect(new PushSubscriptionStore(home()).list()).toEqual([]);
  });
});

describe("wouldDeliverPush (the shouldPush call site)", () => {
  test("true only for a high-signal kind AND at least one subscription", () => {
    const h = home();
    const store = new PushSubscriptionStore(h);
    expect(wouldDeliverPush("approval", "s1", store)).toBe(false); // policy ok but NO subscriptions
    store.add("d1", sub(), "t0");
    expect(wouldDeliverPush("approval", "s1", store)).toBe(true);
    expect(wouldDeliverPush("budget", "s1", store)).toBe(false); // budget is intentionally not push-worthy
  });

  test("respects a per-session mute", () => {
    const h = home();
    const store = new PushSubscriptionStore(h);
    store.add("d1", sub(), "t0");
    expect(wouldDeliverPush("error", "s1", store, { mutedSessions: new Set(["s1"]) })).toBe(false);
    expect(wouldDeliverPush("error", "s2", store, { mutedSessions: new Set(["s1"]) })).toBe(true);
  });
});
