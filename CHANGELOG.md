# Changelog

## 0.1.0 (2026-10-27)

- Initial release: `plan_rename` MCP tool and `plan` CLI
  command planning a safe file or export rename from a
  caller-supplied module graph.
- Pinned file semantics: a direct referencer statically
  imports and/or dynamically imports the target file, with
  `kinds` in static-then-dynamic order; indirect
  referencers are found by breadth-first expansion over
  reverse static edges, and an indirect referencer's `via`
  is the qualifying import that appears first in the
  modules input order.
- Pinned export semantics: a direct referencer imports the
  export name from its defining module over a named-binding
  edge; indirect referencers follow re-export chains only,
  so an import of the name from a module that does not
  export it counts nowhere.
- Pinned output: `direct` and `indirect` sorted by path in
  code-unit order, `edit_order` as direct then indirect
  then the target module last, flags in the order
  `dynamic_reference`, `reexport_chain`,
  `wide_blast_radius` (the last at 10 or more affected
  modules), and counts with `total_affected` as direct
  plus indirect.
- Path-naming validation for the target and every module,
  import, export, and dynamic-import entry, duplicate
  module path detection, and target-resolution errors for
  a missing target module or a missing export.
