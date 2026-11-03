import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { planRename } from "../src/renameplan.js";

/**
 * All tests are pure local computation over inline module
 * graphs: no filesystem and no network. The file-kind
 * static/dynamic direct rules, the breadth-first indirect
 * expansion over reverse static edges, the export-kind
 * named-binding and re-export-chain rules, the via
 * first-in-modules-input-order judgement call, the
 * import-from-a-non-re-exporter judgement call, code-unit
 * sorting, edit_order composition, the pinned flag order,
 * target resolution, duplicate paths, and every validation
 * path are each pinned with hand-computed graphs.
 */

const P = "src/p.ts";
const fileTarget = { kind: "file", name: P } as const;

function filePlan(modules: unknown[]) {
  return planRename({ target: fileTarget, modules });
}

describe("planRename — file kind, direct referencers", () => {
  it("a static-only direct referencer has kinds [\"static\"] and the exact output shape", () => {
    const out = filePlan([
      { path: P },
      { path: "src/a.ts", imports: [{ from: P }] },
      { path: "src/unrelated.ts" },
    ]);
    assert.deepEqual(out, {
      target: { kind: "file", name: P, module: null },
      direct: [{ path: "src/a.ts", kinds: ["static"] }],
      indirect: [],
      edit_order: ["src/a.ts", P],
      flags: [],
      counts: { direct: 1, indirect: 0, total_affected: 1 },
    });
  });

  it("a dynamic-only direct referencer has kinds [\"dynamic\"] and the dynamic_reference flag", () => {
    const out = filePlan([
      { path: P },
      { path: "src/dyn.ts", dynamic_imports: [P] },
    ]);
    assert.deepEqual(out.direct, [{ path: "src/dyn.ts", kinds: ["dynamic"] }]);
    assert.deepEqual(out.flags, ["dynamic_reference"]);
    assert.deepEqual(out.indirect, []);
  });

  it("a referencer with both edges has kinds [\"static\", \"dynamic\"] in that order", () => {
    const out = filePlan([
      { path: P },
      {
        path: "src/both.ts",
        imports: [{ from: P }],
        dynamic_imports: [P],
      },
    ]);
    assert.deepEqual(out.direct, [
      { path: "src/both.ts", kinds: ["static", "dynamic"] },
    ]);
    assert.deepEqual(out.flags, ["dynamic_reference"]);
  });

  it("a static import with an empty names list is still a static direct referencer for a file", () => {
    const out = filePlan([
      { path: P, exports: ["foo"] },
      { path: "src/a.ts", imports: [{ from: P, names: [] }] },
    ]);
    assert.deepEqual(out.direct, [{ path: "src/a.ts", kinds: ["static"] }]);
  });

  it("a target with no referencers has empty direct/indirect, no flags, and edit_order of just the target", () => {
    const out = filePlan([
      { path: P },
      { path: "src/lonely.ts", imports: [{ from: "src/other.ts" }] },
      { path: "src/other.ts" },
    ]);
    assert.deepEqual(out.direct, []);
    assert.deepEqual(out.indirect, []);
    assert.deepEqual(out.flags, []);
    assert.deepEqual(out.edit_order, [P]);
    assert.deepEqual(out.counts, { direct: 0, indirect: 0, total_affected: 0 });
  });

  it("a self-import by the target module itself is ignored", () => {
    const out = filePlan([
      { path: P, imports: [{ from: P }], dynamic_imports: [P] },
      { path: "src/other.ts" },
    ]);
    assert.deepEqual(out.direct, []);
    assert.deepEqual(out.indirect, []);
    assert.deepEqual(out.flags, []);
    assert.deepEqual(out.edit_order, [P]);
  });
});

describe("planRename — file kind, indirect referencers", () => {
  it("a 3-level chain puts level 2 and level 3 in indirect with the correct vias", () => {
    const out = filePlan([
      { path: P },
      { path: "src/l1.ts", imports: [{ from: P }] },
      { path: "src/l2.ts", imports: [{ from: "src/l1.ts" }] },
      { path: "src/l3.ts", imports: [{ from: "src/l2.ts" }] },
    ]);
    assert.deepEqual(out.direct, [{ path: "src/l1.ts", kinds: ["static"] }]);
    assert.deepEqual(out.indirect, [
      { path: "src/l2.ts", via: "src/l1.ts" },
      { path: "src/l3.ts", via: "src/l2.ts" },
    ]);
    assert.deepEqual(out.edit_order, ["src/l1.ts", "src/l2.ts", "src/l3.ts", P]);
    assert.deepEqual(out.counts, { direct: 1, indirect: 2, total_affected: 3 });
  });

  it("diamond: when two imports qualify as via, the one first in modules input order wins (pinned judgement call)", () => {
    // Modules input order is p, b, a, y: b precedes a in the
    // input even though y lists a first in its own imports
    // and a sorts first by path. The via must be b.
    const out = filePlan([
      { path: P },
      { path: "src/b.ts", imports: [{ from: P }] },
      { path: "src/a.ts", imports: [{ from: P }] },
      {
        path: "src/y.ts",
        imports: [{ from: "src/a.ts" }, { from: "src/b.ts" }],
      },
    ]);
    assert.deepEqual(out.direct, [
      { path: "src/a.ts", kinds: ["static"] },
      { path: "src/b.ts", kinds: ["static"] },
    ]);
    assert.deepEqual(out.indirect, [{ path: "src/y.ts", via: "src/b.ts" }]);
  });

  it("via is a module one level closer, not merely any module on a longer path", () => {
    const out = filePlan([
      { path: P },
      { path: "src/a.ts", imports: [{ from: P }] },
      { path: "src/b.ts", imports: [{ from: "src/a.ts" }] },
      {
        path: "src/y.ts",
        imports: [{ from: "src/b.ts" }, { from: "src/a.ts" }],
      },
    ]);
    // y reaches P in two static edges through a, and in
    // three through b; its level is 2 and its via is a.
    assert.deepEqual(out.indirect, [
      { path: "src/b.ts", via: "src/a.ts" },
      { path: "src/y.ts", via: "src/a.ts" },
    ]);
  });

  it("a dynamic edge does not carry a chain: statically importing a dynamic-only referencer counts nowhere", () => {
    const out = filePlan([
      { path: P },
      { path: "src/x.ts", dynamic_imports: [P] },
      { path: "src/y.ts", imports: [{ from: "src/x.ts" }] },
    ]);
    assert.deepEqual(out.direct, [{ path: "src/x.ts", kinds: ["dynamic"] }]);
    assert.deepEqual(out.indirect, []);
    assert.deepEqual(out.counts, { direct: 1, indirect: 0, total_affected: 1 });
  });

  it("a direct referencer is never also listed as indirect, even when a static chain also reaches it", () => {
    const out = filePlan([
      { path: P },
      { path: "src/l1.ts", imports: [{ from: P }] },
      {
        path: "src/m.ts",
        imports: [{ from: "src/l1.ts" }],
        dynamic_imports: [P],
      },
    ]);
    assert.deepEqual(out.direct, [
      { path: "src/l1.ts", kinds: ["static"] },
      { path: "src/m.ts", kinds: ["dynamic"] },
    ]);
    assert.deepEqual(out.indirect, []);
  });

  it("an unrelated cycle that never reaches the target produces no indirect referencers", () => {
    const out = filePlan([
      { path: P },
      { path: "src/a.ts", imports: [{ from: "src/b.ts" }] },
      { path: "src/b.ts", imports: [{ from: "src/a.ts" }] },
    ]);
    assert.deepEqual(out.direct, []);
    assert.deepEqual(out.indirect, []);
  });
});

describe("planRename — sorting and edit_order", () => {
  it("direct paths sort code-unit ascending: uppercase before lowercase", () => {
    const out = planRename({
      target: { kind: "file", name: "src/t.ts" },
      modules: [
        { path: "src/t.ts" },
        { path: "src/a.ts", imports: [{ from: "src/t.ts" }] },
        { path: "src/B.ts", imports: [{ from: "src/t.ts" }] },
        { path: "src/Z.ts", imports: [{ from: "src/t.ts" }] },
      ],
    });
    assert.deepEqual(
      out.direct.map((d) => d.path),
      ["src/B.ts", "src/Z.ts", "src/a.ts"],
    );
    assert.deepEqual(out.edit_order, ["src/B.ts", "src/Z.ts", "src/a.ts", "src/t.ts"]);
  });

  it("edit_order is direct sorted, then indirect sorted, then the target last — not a global sort", () => {
    const out = planRename({
      target: { kind: "file", name: "src/t.ts" },
      modules: [
        { path: "src/t.ts" },
        { path: "src/z-direct.ts", imports: [{ from: "src/t.ts" }] },
        { path: "src/a-indirect.ts", imports: [{ from: "src/z-direct.ts" }] },
      ],
    });
    assert.deepEqual(out.edit_order, [
      "src/z-direct.ts",
      "src/a-indirect.ts",
      "src/t.ts",
    ]);
  });

  it("indirect paths sort code-unit ascending independently of input order", () => {
    const out = filePlan([
      { path: P },
      { path: "src/l1.ts", imports: [{ from: P }] },
      { path: "src/z-ind.ts", imports: [{ from: "src/l1.ts" }] },
      { path: "src/A-ind.ts", imports: [{ from: "src/l1.ts" }] },
    ]);
    assert.deepEqual(out.indirect, [
      { path: "src/A-ind.ts", via: "src/l1.ts" },
      { path: "src/z-ind.ts", via: "src/l1.ts" },
    ]);
  });
});

describe("planRename — file kind, wide_blast_radius and flag order", () => {
  function manyDirect(count: number, dynamicOne = false) {
    const modules: unknown[] = [{ path: P }];
    for (let i = 0; i < count; i++) {
      const path = `src/m${String(i).padStart(2, "0")}.ts`;
      if (dynamicOne && i === 0) modules.push({ path, dynamic_imports: [P] });
      else modules.push({ path, imports: [{ from: P }] });
    }
    return modules;
  }

  it("9 direct referencers do not fire wide_blast_radius", () => {
    const out = filePlan(manyDirect(9));
    assert.equal(out.counts.total_affected, 9);
    assert.deepEqual(out.flags, []);
  });

  it("10 direct referencers fire exactly [\"wide_blast_radius\"] when none is dynamic", () => {
    const out = filePlan(manyDirect(10));
    assert.equal(out.counts.total_affected, 10);
    assert.deepEqual(out.flags, ["wide_blast_radius"]);
  });

  it("flag order is pinned: [\"dynamic_reference\", \"wide_blast_radius\"] when a dynamic referencer exists at >= 10", () => {
    const out = filePlan(manyDirect(10, true));
    assert.deepEqual(out.flags, ["dynamic_reference", "wide_blast_radius"]);
  });

  it("wide_blast_radius counts direct plus indirect together", () => {
    const modules: unknown[] = [{ path: P }];
    for (let i = 0; i < 6; i++) {
      modules.push({ path: `src/d${i}.ts`, imports: [{ from: P }] });
    }
    for (let i = 0; i < 4; i++) {
      modules.push({ path: `src/i${i}.ts`, imports: [{ from: "src/d0.ts" }] });
    }
    const out = filePlan(modules);
    assert.deepEqual(out.counts, { direct: 6, indirect: 4, total_affected: 10 });
    assert.deepEqual(out.flags, ["wide_blast_radius"]);
  });
});

const DEF = "src/def.ts";
const exportTarget = { kind: "export", name: "foo", module: DEF } as const;

function exportPlan(modules: unknown[]) {
  return planRename({ target: exportTarget, modules });
}

describe("planRename — export kind, direct referencers", () => {
  it("a direct referencer via a named binding has kinds [\"static\"] and the exact output shape", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo", "bar"] },
      { path: "src/x.ts", imports: [{ from: DEF, names: ["foo"] }] },
    ]);
    assert.deepEqual(out, {
      target: { kind: "export", name: "foo", module: DEF },
      direct: [{ path: "src/x.ts", kinds: ["static"] }],
      indirect: [],
      edit_order: ["src/x.ts", DEF],
      flags: [],
      counts: { direct: 1, indirect: 0, total_affected: 1 },
    });
  });

  it("a namespace-style import (names absent) is NOT a reference to the export", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"] },
      { path: "src/x.ts", imports: [{ from: DEF }] },
    ]);
    assert.deepEqual(out.direct, []);
    assert.deepEqual(out.indirect, []);
    assert.deepEqual(out.edit_order, [DEF]);
  });

  it("an import of a different name from the defining module is NOT a reference", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo", "bar"] },
      { path: "src/x.ts", imports: [{ from: DEF, names: ["bar"] }] },
    ]);
    assert.deepEqual(out.direct, []);
    assert.deepEqual(out.indirect, []);
  });

  it("a named import among several names counts when the export name is one of them", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo", "bar"] },
      { path: "src/x.ts", imports: [{ from: DEF, names: ["bar", "foo"] }] },
    ]);
    assert.deepEqual(out.direct, [{ path: "src/x.ts", kinds: ["static"] }]);
  });

  it("a dynamic import never references an export", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"] },
      { path: "src/x.ts", dynamic_imports: [DEF] },
    ]);
    assert.deepEqual(out.direct, []);
    assert.deepEqual(out.flags, []);
  });

  it("the defining module importing its own export is ignored", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"], imports: [{ from: DEF, names: ["foo"] }] },
      { path: "src/other.ts" },
    ]);
    assert.deepEqual(out.direct, []);
    assert.deepEqual(out.indirect, []);
  });
});

describe("planRename — export kind, re-export chains", () => {
  it("a re-export chain makes the re-exporter's importer indirect with via = the re-exporter, and fires reexport_chain", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"] },
      {
        path: "src/x.ts",
        imports: [{ from: DEF, names: ["foo"] }],
        exports: ["foo"],
      },
      { path: "src/y.ts", imports: [{ from: "src/x.ts", names: ["foo"] }] },
    ]);
    assert.deepEqual(out.direct, [{ path: "src/x.ts", kinds: ["static"] }]);
    assert.deepEqual(out.indirect, [{ path: "src/y.ts", via: "src/x.ts" }]);
    assert.deepEqual(out.flags, ["reexport_chain"]);
    assert.deepEqual(out.edit_order, ["src/x.ts", "src/y.ts", DEF]);
    assert.deepEqual(out.counts, { direct: 1, indirect: 1, total_affected: 2 });
  });

  it("a transitive re-export chain reaches level 3 with the correct via at each level", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"] },
      {
        path: "src/x.ts",
        imports: [{ from: DEF, names: ["foo"] }],
        exports: ["foo"],
      },
      {
        path: "src/y.ts",
        imports: [{ from: "src/x.ts", names: ["foo"] }],
        exports: ["foo"],
      },
      { path: "src/z.ts", imports: [{ from: "src/y.ts", names: ["foo"] }] },
    ]);
    assert.deepEqual(out.indirect, [
      { path: "src/y.ts", via: "src/x.ts" },
      { path: "src/z.ts", via: "src/y.ts" },
    ]);
    assert.deepEqual(out.flags, ["reexport_chain"]);
  });

  it("importing the name from a NON-re-exporting direct referencer counts nowhere (pinned judgement call)", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"] },
      {
        path: "src/x.ts",
        imports: [{ from: DEF, names: ["foo"] }],
        exports: ["other"],
      },
      { path: "src/y.ts", imports: [{ from: "src/x.ts", names: ["foo"] }] },
    ]);
    assert.deepEqual(out.direct, [{ path: "src/x.ts", kinds: ["static"] }]);
    assert.deepEqual(out.indirect, []);
    // x does not re-export, so no reexport_chain either.
    assert.deepEqual(out.flags, []);
    assert.deepEqual(out.counts, { direct: 1, indirect: 0, total_affected: 1 });
  });

  it("a chain breaks at a non-re-exporting link even when a later module re-exports", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"] },
      {
        path: "src/x.ts",
        imports: [{ from: DEF, names: ["foo"] }],
        exports: ["foo"],
      },
      {
        path: "src/y.ts",
        imports: [{ from: "src/x.ts", names: ["foo"] }],
        // y does NOT re-export foo.
      },
      {
        path: "src/z.ts",
        imports: [{ from: "src/y.ts", names: ["foo"] }],
        exports: ["foo"],
      },
    ]);
    assert.deepEqual(out.indirect, [{ path: "src/y.ts", via: "src/x.ts" }]);
    assert.deepEqual(out.counts, { direct: 1, indirect: 1, total_affected: 2 });
  });

  it("importing the name from a module that exports it independently, outside the chain, counts nowhere", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"] },
      { path: "src/w.ts", exports: ["foo"] },
      { path: "src/y.ts", imports: [{ from: "src/w.ts", names: ["foo"] }] },
    ]);
    assert.deepEqual(out.direct, []);
    assert.deepEqual(out.indirect, []);
  });

  it("export diamond: via is the qualifying re-exporter first in modules input order (pinned judgement call)", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"] },
      {
        path: "src/b.ts",
        imports: [{ from: DEF, names: ["foo"] }],
        exports: ["foo"],
      },
      {
        path: "src/a.ts",
        imports: [{ from: DEF, names: ["foo"] }],
        exports: ["foo"],
      },
      {
        path: "src/y.ts",
        imports: [
          { from: "src/a.ts", names: ["foo"] },
          { from: "src/b.ts", names: ["foo"] },
        ],
      },
    ]);
    assert.deepEqual(out.indirect, [{ path: "src/y.ts", via: "src/b.ts" }]);
  });

  it("flag order is pinned: [\"reexport_chain\", \"wide_blast_radius\"] for an export at >= 10 affected", () => {
    const modules: unknown[] = [{ path: DEF, exports: ["foo"] }];
    for (let i = 0; i < 10; i++) {
      modules.push({
        path: `src/m${String(i).padStart(2, "0")}.ts`,
        imports: [{ from: DEF, names: ["foo"] }],
        ...(i === 0 ? { exports: ["foo"] } : {}),
      });
    }
    const out = exportPlan(modules);
    assert.equal(out.counts.total_affected, 10);
    assert.deepEqual(out.flags, ["reexport_chain", "wide_blast_radius"]);
  });

  it("an export target with no referencers has empty lists and edit_order of just the defining module", () => {
    const out = exportPlan([
      { path: DEF, exports: ["foo"] },
      { path: "src/lonely.ts" },
    ]);
    assert.deepEqual(out.direct, []);
    assert.deepEqual(out.indirect, []);
    assert.deepEqual(out.flags, []);
    assert.deepEqual(out.edit_order, [DEF]);
  });
});

describe("planRename — target resolution errors", () => {
  const throws = (args: unknown, message: string) =>
    assert.throws(() => planRename(args), { message });

  it("kind file with no module at the target path errors naming the target", () => {
    throws(
      { target: { kind: "file", name: "src/missing.ts" }, modules: [{ path: P }] },
      "target module not found: src/missing.ts",
    );
  });

  it("kind export whose defining module is absent from the graph errors naming that module", () => {
    throws(
      {
        target: { kind: "export", name: "foo", module: "src/missing.ts" },
        modules: [{ path: DEF, exports: ["foo"] }],
      },
      "target module not found: src/missing.ts",
    );
  });

  it("kind export whose name the defining module does not export errors naming name and module", () => {
    throws(
      { target: exportTarget, modules: [{ path: DEF, exports: ["bar"] }] },
      "export not found: foo in src/def.ts",
    );
    throws(
      { target: exportTarget, modules: [{ path: DEF }] },
      "export not found: foo in src/def.ts",
    );
  });

  it("kind export with the module field missing errors naming target.module", () => {
    throws(
      { target: { kind: "export", name: "foo" }, modules: [{ path: DEF, exports: ["foo"] }] },
      "target.module is required",
    );
  });

  it("duplicate module paths are an error naming the duplicated path", () => {
    throws(
      {
        target: fileTarget,
        modules: [{ path: "src/a.ts" }, { path: P }, { path: "src/a.ts" }],
      },
      "duplicate module path: src/a.ts",
    );
  });

  it("kind file with a string module field present is accepted and the field is ignored (output module is null)", () => {
    const out = planRename({
      target: { kind: "file", name: P, module: "src/whatever.ts" },
      modules: [{ path: P }],
    });
    assert.deepEqual(out.target, { kind: "file", name: P, module: null });
  });
});

describe("planRename — validation", () => {
  const throws = (args: unknown, message: string) =>
    assert.throws(() => planRename(args), { message });
  const goodModules = [{ path: P }];

  it("target missing names target", () => {
    throws({ modules: goodModules }, "target is required");
    throws({}, "target is required");
  });

  it("a non-object top-level argument is treated as {} and fails on target", () => {
    throws(null, "target is required");
    throws([], "target is required");
    throws("plan", "target is required");
    throws(42, "target is required");
    throws(undefined, "target is required");
  });

  it("target not an object names target", () => {
    throws({ target: "x", modules: goodModules }, "target must be an object");
    throws({ target: [], modules: goodModules }, "target must be an object");
    throws({ target: null, modules: goodModules }, "target must be an object");
  });

  it("kind missing names target.kind", () => {
    throws({ target: { name: P }, modules: goodModules }, "target.kind is required");
  });

  it("kind outside the pinned enum names target.kind", () => {
    throws(
      { target: { kind: "directory", name: P }, modules: goodModules },
      'target.kind must be one of "file" or "export"',
    );
    throws(
      { target: { kind: 42, name: P }, modules: goodModules },
      'target.kind must be one of "file" or "export"',
    );
    throws(
      { target: { kind: "FILE", name: P }, modules: goodModules },
      'target.kind must be one of "file" or "export"',
    );
  });

  it("name missing, empty, or non-string names target.name", () => {
    throws({ target: { kind: "file" }, modules: goodModules }, "target.name is required");
    throws(
      { target: { kind: "file", name: "" }, modules: goodModules },
      "target.name must be a non-empty string",
    );
    throws(
      { target: { kind: "file", name: 7 }, modules: goodModules },
      "target.name must be a non-empty string",
    );
    throws(
      { target: { kind: "file", name: null }, modules: goodModules },
      "target.name must be a non-empty string",
    );
  });

  it("module present but not a string names target.module (kind file)", () => {
    throws(
      { target: { kind: "file", name: P, module: 42 }, modules: goodModules },
      "target.module must be a string",
    );
    throws(
      { target: { kind: "file", name: P, module: null }, modules: goodModules },
      "target.module must be a string",
    );
  });

  it("kind export module empty or non-string names target.module as non-empty", () => {
    throws(
      { target: { kind: "export", name: "foo", module: "" }, modules: goodModules },
      "target.module must be a non-empty string",
    );
    throws(
      { target: { kind: "export", name: "foo", module: 42 }, modules: goodModules },
      "target.module must be a non-empty string",
    );
  });

  it("modules missing, not an array, or empty names modules", () => {
    throws({ target: fileTarget }, "modules is required");
    throws({ target: fileTarget, modules: "graph" }, "modules must be an array");
    throws({ target: fileTarget, modules: {} }, "modules must be an array");
    throws({ target: fileTarget, modules: [] }, "modules must contain at least 1 item");
  });

  it("a module item that is not an object names its index", () => {
    throws({ target: fileTarget, modules: ["src/a.ts"] }, "modules[0] must be an object");
    throws({ target: fileTarget, modules: [{ path: P }, null] }, "modules[1] must be an object");
  });

  it("path missing, empty, or non-string names the deep path", () => {
    throws({ target: fileTarget, modules: [{}] }, "modules[0].path is required");
    throws(
      { target: fileTarget, modules: [{ path: P }, { path: "" }] },
      "modules[1].path must be a non-empty string",
    );
    throws(
      { target: fileTarget, modules: [{ path: 9 }] },
      "modules[0].path must be a non-empty string",
    );
  });

  it("imports present but not an array names the deep path", () => {
    throws(
      { target: fileTarget, modules: [{ path: P, imports: "x" }] },
      "modules[0].imports must be an array",
    );
  });

  it("an import item that is not an object names the deep path", () => {
    throws(
      { target: fileTarget, modules: [{ path: P, imports: ["src/a.ts"] }] },
      "modules[0].imports[0] must be an object",
    );
  });

  it("import from missing, empty, or non-string names the deep path", () => {
    throws(
      { target: fileTarget, modules: [{ path: P }, { path: "src/a.ts", imports: [{}] }] },
      "modules[1].imports[0].from is required",
    );
    throws(
      { target: fileTarget, modules: [{ path: P, imports: [{ from: "" }] }] },
      "modules[0].imports[0].from must be a non-empty string",
    );
    throws(
      { target: fileTarget, modules: [{ path: P, imports: [{ from: 3 }] }] },
      "modules[0].imports[0].from must be a non-empty string",
    );
  });

  it("import names present but not an array names the deep path", () => {
    throws(
      { target: fileTarget, modules: [{ path: P, imports: [{ from: "src/a.ts", names: "foo" }] }] },
      "modules[0].imports[0].names must be an array",
    );
  });

  it("import names containing a non-string names the element's deep path", () => {
    throws(
      {
        target: fileTarget,
        modules: [{ path: P, imports: [{ from: "src/a.ts", names: ["foo", 42] }] }],
      },
      "modules[0].imports[0].names[1] must be a string",
    );
  });

  it("exports present but not an array, or containing a non-string, names the deep path", () => {
    throws(
      { target: fileTarget, modules: [{ path: P, exports: "foo" }] },
      "modules[0].exports must be an array",
    );
    throws(
      { target: fileTarget, modules: [{ path: P, exports: ["foo", null] }] },
      "modules[0].exports[1] must be a string",
    );
  });

  it("dynamic_imports present but not an array, or containing a non-string, names the deep path", () => {
    throws(
      { target: fileTarget, modules: [{ path: P, dynamic_imports: P }] },
      "modules[0].dynamic_imports must be an array",
    );
    throws(
      { target: fileTarget, modules: [{ path: P, dynamic_imports: [false] }] },
      "modules[0].dynamic_imports[0] must be a string",
    );
  });

  it("unknown extra fields are ignored, including inside target, modules, and import items", () => {
    const out = planRename({
      target: { kind: "file", name: P, comment: "rename it" },
      modules: [
        { path: P, language: "ts" },
        {
          path: "src/a.ts",
          imports: [{ from: P, comment: "static" }],
          extra: [1, 2, 3],
        },
      ],
      version: 3,
    });
    assert.deepEqual(out.direct, [{ path: "src/a.ts", kinds: ["static"] }]);
  });

  it("no partial result is produced on invalid input", () => {
    assert.throws(() =>
      planRename({
        target: fileTarget,
        modules: [{ path: P }, { path: P }],
      }),
    );
  });
});
