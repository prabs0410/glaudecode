import { describe, expect, test } from "bun:test";
import { GraphManager, mapGraphJson } from "../src/graph";

describe("mapGraphJson", () => {
  test("maps nodes and edges from canonical fields", () => {
    const out = mapGraphJson({
      nodes: [
        { id: "a", label: "A", kind: "file" },
        { id: "b", label: "B", kind: "symbol" },
      ],
      edges: [{ from: "a", to: "b", kind: "imports" }],
    });
    expect(out.nodes).toHaveLength(2);
    expect(out.edges).toEqual([{ from: "a", to: "b", kind: "imports" }]);
    expect(out.truncated).toBe(false);
  });

  test("tolerates name/type and source/target/links variants", () => {
    const out = mapGraphJson({
      nodes: [{ name: "x", type: "module" }, { name: "y" }],
      links: [{ source: "x", target: "y", type: "calls" }],
    });
    expect(out.nodes[0]).toEqual({ id: "x", label: "x", kind: "module" });
    expect(out.nodes[1].kind).toBe("node"); // default
    expect(out.edges[0]).toEqual({ from: "x", to: "y", kind: "calls" });
  });

  test("drops edges that reference unknown/dropped nodes", () => {
    const out = mapGraphJson({
      nodes: [{ id: "a" }],
      edges: [{ from: "a", to: "ghost" }],
    });
    expect(out.edges).toEqual([]);
  });

  test("caps large graphs and marks truncated", () => {
    const nodes = Array.from({ length: 10 }, (_, i) => ({ id: `n${i}` }));
    const out = mapGraphJson({ nodes }, 3);
    expect(out.nodes).toHaveLength(3);
    expect(out.truncated).toBe(true);
  });

  test("empty/garbage json yields an empty graph", () => {
    expect(mapGraphJson(null)).toEqual({ nodes: [], edges: [], truncated: false });
    expect(mapGraphJson({ foo: 1 }).nodes).toEqual([]);
  });
});

describe("GraphManager.buildGraph", () => {
  test("degrades gracefully when graphify is not installed", async () => {
    const mgr = new GraphManager({ bin: "glaude-no-such-binary-xyz" });
    const res = await mgr.buildGraph("/tmp");
    expect(res.available).toBe(false);
    expect(res.reason).toMatch(/graphify/i);
    expect(res.nodes).toEqual([]);
  });
});
