/**
 * renameplan core: plan a safe file or export rename from
 * a caller-supplied module graph.
 *
 *   planRename(args) -> { target, direct, indirect,
 *                         edit_order, flags, counts }
 *
 * Graph notions (pinned):
 *   Static edge: A statically imports B iff some imports
 *     item of A has `from` equal to B's path.
 *   Named-binding edge: A imports name E from B iff some
 *     imports item of A has `from` equal to B's path and
 *     its `names` include E. An imports item with `names`
 *     absent imports the module with NO named bindings.
 *
 * Kind "file" (P = target.name):
 *   DIRECT: a module M != P that statically imports P
 *     and/or lists P in dynamic_imports. `kinds` contains
 *     "static" iff it statically imports P and "dynamic"
 *     iff it dynamically imports P, in that order.
 *   INDIRECT: a module that is neither the target nor a
 *     direct referencer, from which P is reachable through
 *     two or more static edges. Breadth-first expansion
 *     from P over reverse static edges: level 1 is the
 *     static direct referencers, level >= 2 is indirect.
 *     An indirect module's `via` is the module it
 *     statically imports that lies one level closer to P;
 *     ties break to the qualifying module that appears
 *     FIRST in the modules input order (pinned judgement
 *     call).
 *
 * Kind "export" (M = target.module, E = target.name):
 *   DIRECT: a module X != M that imports E from M over a
 *     named-binding edge. `kinds` is ["static"]. Dynamic
 *     imports never reference an export. A direct
 *     referencer re-exports E iff its own exports include E.
 *   INDIRECT: a module Y that imports E from a direct
 *     referencer that re-exports E, or transitively through
 *     further re-exporting referencers. The same
 *     breadth-first expansion runs over named-binding edges
 *     for E, following re-export chains only: an import of
 *     E from a module that does not export E is not a
 *     reference and counts nowhere (pinned judgement call).
 *     `via` follows the same first-in-input-order rule.
 *
 * Sorting (pinned): `direct` and `indirect` are each
 * sorted by path, code-unit ascending. `edit_order` is the
 * direct paths in that sorted order, then the indirect
 * paths in that sorted order, then the target module's
 * path last (P for kind file, M for kind export).
 *
 * Flags (pinned order, each included iff its condition
 * holds): "dynamic_reference" (kind file and some direct
 * referencer has "dynamic"), then "reexport_chain" (kind
 * export and some direct referencer re-exports E), then
 * "wide_blast_radius" (direct + indirect >= 10).
 *
 * Validation is strict and path-naming: any malformed
 * input, a duplicate module path, or a target that does
 * not resolve throws an Error naming the offending path
 * and no partial result is produced. Unknown extra fields
 * are ignored, including inside items; a non-object
 * top-level argument is treated as {}.
 */
import type {
  DirectReferencer,
  IndirectReferencer,
  ReferenceKind,
  RenameFlag,
  RenamePlanResult,
  TargetKind,
} from "./types.js";

export const VERSION = "0.1.0";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

interface ImportItem {
  from: string;
  names: string[] | undefined;
}

interface ModuleNode {
  path: string;
  imports: ImportItem[];
  exports: string[];
  dynamic_imports: string[];
  /** Position in the modules input array. */
  index: number;
}

function stringList(
  raw: Record<string, unknown>,
  key: string,
  path: string,
): string[] {
  const value = raw[key];
  if (value === undefined) return [];
  if (!Array.isArray(value)) {
    throw new Error(`${path} must be an array`);
  }
  const out: string[] = [];
  for (let i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string") {
      throw new Error(`${path}[${i}] must be a string`);
    }
    out.push(value[i] as string);
  }
  return out;
}

function parseModules(raw: Record<string, unknown>): ModuleNode[] {
  if (raw.modules === undefined) throw new Error("modules is required");
  if (!Array.isArray(raw.modules)) throw new Error("modules must be an array");
  if (raw.modules.length === 0) {
    throw new Error("modules must contain at least 1 item");
  }
  const modules: ModuleNode[] = [];
  const seen = new Set<string>();
  for (let i = 0; i < raw.modules.length; i++) {
    const item: unknown = raw.modules[i];
    const base = `modules[${i}]`;
    if (!isRecord(item)) throw new Error(`${base} must be an object`);
    if (item.path === undefined) throw new Error(`${base}.path is required`);
    if (typeof item.path !== "string" || item.path.length === 0) {
      throw new Error(`${base}.path must be a non-empty string`);
    }
    const path = item.path;
    if (seen.has(path)) throw new Error(`duplicate module path: ${path}`);
    seen.add(path);

    const imports: ImportItem[] = [];
    if (item.imports !== undefined) {
      if (!Array.isArray(item.imports)) {
        throw new Error(`${base}.imports must be an array`);
      }
      for (let j = 0; j < item.imports.length; j++) {
        const imp: unknown = item.imports[j];
        const ibase = `${base}.imports[${j}]`;
        if (!isRecord(imp)) throw new Error(`${ibase} must be an object`);
        if (imp.from === undefined) throw new Error(`${ibase}.from is required`);
        if (typeof imp.from !== "string" || imp.from.length === 0) {
          throw new Error(`${ibase}.from must be a non-empty string`);
        }
        let names: string[] | undefined;
        if (imp.names !== undefined) {
          names = stringList(imp, "names", `${ibase}.names`);
        }
        imports.push({ from: imp.from, names });
      }
    }

    const exportsList = stringList(item, "exports", `${base}.exports`);
    const dynamicImports = stringList(
      item,
      "dynamic_imports",
      `${base}.dynamic_imports`,
    );
    modules.push({
      path,
      imports,
      exports: exportsList,
      dynamic_imports: dynamicImports,
      index: i,
    });
  }
  return modules;
}

interface ParsedTarget {
  kind: TargetKind;
  name: string;
  module: string | null;
}

function parseTarget(raw: Record<string, unknown>): ParsedTarget {
  if (raw.target === undefined) throw new Error("target is required");
  if (!isRecord(raw.target)) throw new Error("target must be an object");
  const t = raw.target;
  if (t.kind === undefined) throw new Error("target.kind is required");
  if (t.kind !== "file" && t.kind !== "export") {
    throw new Error('target.kind must be one of "file" or "export"');
  }
  const kind = t.kind as TargetKind;
  if (t.name === undefined) throw new Error("target.name is required");
  if (typeof t.name !== "string" || t.name.length === 0) {
    throw new Error("target.name must be a non-empty string");
  }
  const name = t.name;
  if (kind === "export") {
    if (t.module === undefined) throw new Error("target.module is required");
    if (typeof t.module !== "string" || t.module.length === 0) {
      throw new Error("target.module must be a non-empty string");
    }
    return { kind, name, module: t.module };
  }
  // Kind "file": a module field, when present, is validated
  // as a string and otherwise ignored.
  if (t.module !== undefined && typeof t.module !== "string") {
    throw new Error("target.module must be a string");
  }
  return { kind, name, module: null };
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/**
 * Breadth-first levels from `start` over reverse edges.
 * `predecessors.get(node)` lists the modules that hold an
 * edge TO `node` (i.e. modules that import `node` in the
 * relevant sense). Level 0 is the start node itself.
 */
function bfsLevels(
  start: string,
  predecessors: Map<string, string[]>,
): Map<string, number> {
  const level = new Map<string, number>();
  level.set(start, 0);
  const queue: string[] = [start];
  for (let head = 0; head < queue.length; head++) {
    const cur = queue[head] as string;
    const curLevel = level.get(cur) as number;
    for (const pred of predecessors.get(cur) ?? []) {
      if (!level.has(pred)) {
        level.set(pred, curLevel + 1);
        queue.push(pred);
      }
    }
  }
  return level;
}

/**
 * Pick an indirect module's `via`: among the distinct paths
 * in `candidates` (the modules it imports in the relevant
 * sense) whose level is exactly one less than the module's
 * own level, the one whose module appears first in the
 * modules input order.
 */
function pickVia(
  candidates: string[],
  ownLevel: number,
  level: Map<string, number>,
  indexOf: Map<string, number>,
): string {
  let best: string | undefined;
  let bestIndex = Infinity;
  for (const cand of candidates) {
    if (level.get(cand) !== ownLevel - 1) continue;
    const idx = indexOf.get(cand);
    if (idx === undefined) continue;
    if (idx < bestIndex) {
      bestIndex = idx;
      best = cand;
    }
  }
  // An indirect module is only reached by BFS over a
  // qualifying edge, so a candidate always exists.
  return best as string;
}

/** Plan a safe file or export rename. */
export function planRename(args: unknown): RenamePlanResult {
  const raw: Record<string, unknown> = isRecord(args) ? args : {};
  const target = parseTarget(raw);
  const modules = parseModules(raw);
  const indexOf = new Map<string, number>();
  const byPath = new Map<string, ModuleNode>();
  for (const m of modules) {
    indexOf.set(m.path, m.index);
    byPath.set(m.path, m);
  }

  const direct: DirectReferencer[] = [];
  const directPaths = new Set<string>();
  const flags: RenameFlag[] = [];
  const indirect: IndirectReferencer[] = [];
  let targetPath: string;

  if (target.kind === "file") {
    const p = target.name;
    targetPath = p;
    if (!byPath.has(p)) throw new Error(`target module not found: ${p}`);

    // Direct referencers and the reverse static edge map.
    const staticPredecessors = new Map<string, string[]>();
    for (const m of modules) {
      const staticFroms = new Set<string>();
      for (const imp of m.imports) staticFroms.add(imp.from);
      for (const from of staticFroms) {
        const list = staticPredecessors.get(from) ?? [];
        list.push(m.path);
        staticPredecessors.set(from, list);
      }
      if (m.path === p) continue;
      const kinds: ReferenceKind[] = [];
      if (staticFroms.has(p)) kinds.push("static");
      if (m.dynamic_imports.includes(p)) kinds.push("dynamic");
      if (kinds.length > 0) {
        direct.push({ path: m.path, kinds });
        directPaths.add(m.path);
      }
    }

    const level = bfsLevels(p, staticPredecessors);
    for (const m of modules) {
      if (m.path === p || directPaths.has(m.path)) continue;
      const lv = level.get(m.path);
      if (lv === undefined || lv < 2) continue;
      const candidates = m.imports.map((imp) => imp.from);
      indirect.push({
        path: m.path,
        via: pickVia(candidates, lv, level, indexOf),
      });
    }

    if (direct.some((d) => d.kinds.includes("dynamic"))) {
      flags.push("dynamic_reference");
    }
  } else {
    const mod = target.module as string;
    const e = target.name;
    targetPath = mod;
    const defining = byPath.get(mod);
    if (!defining) throw new Error(`target module not found: ${mod}`);
    if (!defining.exports.includes(e)) {
      throw new Error(`export not found: ${e} in ${mod}`);
    }

    // Named-binding edges for E that are valid references:
    // the imported-from module must itself export E. The
    // defining module exports E (checked above); any other
    // module on a chain exports E exactly when it re-exports
    // it. Edges from a module that does not export E count
    // nowhere and are excluded from the graph entirely.
    const namedPredecessors = new Map<string, string[]>();
    // Distinct named-binding targets per module, for via.
    const namedFromsOf = new Map<string, string[]>();
    for (const m of modules) {
      const namedFroms = new Set<string>();
      for (const imp of m.imports) {
        if (imp.names !== undefined && imp.names.includes(e)) {
          namedFroms.add(imp.from);
        }
      }
      namedFromsOf.set(m.path, [...namedFroms]);
      for (const from of namedFroms) {
        const fromNode = byPath.get(from);
        if (!fromNode || !fromNode.exports.includes(e)) continue;
        const list = namedPredecessors.get(from) ?? [];
        list.push(m.path);
        namedPredecessors.set(from, list);
      }
      if (m.path === mod) continue;
      if (namedFroms.has(mod)) {
        direct.push({ path: m.path, kinds: ["static"] });
        directPaths.add(m.path);
      }
    }

    const level = bfsLevels(mod, namedPredecessors);
    for (const m of modules) {
      if (m.path === mod || directPaths.has(m.path)) continue;
      const lv = level.get(m.path);
      if (lv === undefined || lv < 2) continue;
      indirect.push({
        path: m.path,
        via: pickVia(namedFromsOf.get(m.path) ?? [], lv, level, indexOf),
      });
    }

    const anyReexport = direct.some((d) => {
      const node = byPath.get(d.path);
      return node !== undefined && node.exports.includes(e);
    });
    if (anyReexport) flags.push("reexport_chain");
  }

  direct.sort((a, b) => byCodeUnit(a.path, b.path));
  indirect.sort((a, b) => byCodeUnit(a.path, b.path));

  if (direct.length + indirect.length >= 10) {
    flags.push("wide_blast_radius");
  }

  const editOrder = [
    ...direct.map((d) => d.path),
    ...indirect.map((d) => d.path),
    targetPath,
  ];

  return {
    target: { kind: target.kind, name: target.name, module: target.module },
    direct,
    indirect,
    edit_order: editOrder,
    flags,
    counts: {
      direct: direct.length,
      indirect: indirect.length,
      total_affected: direct.length + indirect.length,
    },
  };
}

/** Render a payload as the JSON text block MCP clients show. */
export function formatPayload(payload: unknown): string {
  return typeof payload === "string" ? payload : JSON.stringify(payload, null, 2);
}
