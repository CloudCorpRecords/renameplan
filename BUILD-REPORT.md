# renameplan — Build Report

MCP Rebuild 1000, Batch 18. Original program build from the
packages-100 plan (cluster H #95), built from the spec in
`~/workspace/mcp-rebuild-100/specs-batch18/renameplan.md`
(read first). There is no external original; the tool surface
is the program's defined spec. Local build only — nothing
pushed or published.

Identity: repo `renameplan`, npm `@reneturcios/renameplan`,
MCP name `io.github.CloudCorpRecords/renameplan`, version
`0.1.0`, bin `renameplan` → `dist/cli.js`.

## Files created (19/19 per TEMPLATE.md checklist)

- `package.json`, `server.json` (description "Plan a safe
  file or export rename: reference graph, edit order, and
  risk flags first." — 85 chars, verified by count; npm entry
  carries `version: 0.1.0`; OCI entry
  `ghcr.io/cloudcorprecords/renameplan:0.1.0` carries **no**
  `version` field), `Dockerfile` (node:20-alpine two-stage,
  label
  `io.modelcontextprotocol.server.name="io.github.CloudCorpRecords/renameplan"`),
  `tsconfig.json` (copied unchanged from the reference),
  `.gitignore`, `LICENSE` (MIT, Copyright (c) 2026 Rene
  Turcios), `README.md` (fresh text), `CHANGELOG.md`
  (single 0.1.0 entry, 2026-10-27), `package-lock.json`
  (Route 3, see below)
- `src/index.ts`, `src/cli.ts` (`plan --input <args.json>`
  where the file holds the full arguments object, `mcp`,
  `--version`; exit 2 usage / 1 runtime error, argument
  validation before any file read), `src/mcp.ts`,
  `src/types.ts`, `src/renameplan.ts` (core,
  `VERSION = "0.1.0"`, `formatPayload`)
- `test/renameplan.test.ts`
- `.github/workflows/{ci,publish,publish-container,registry-publish}.yml`
  (publish-container `IMAGE = ghcr.io/cloudcorprecords/renameplan`,
  smoke-test server-name assertion `renameplan`)

Plus the parity fixture at
`harness/fixtures/renameplan-tools-original.json`, labelled
as a program spec from the packages-100 plan cluster H #95.
The fixture's schema literal is identical to the
`src/mcp.ts` literal at every nested level (`target`,
`modules` items, `imports` items), with properties sorted
alphabetically in the fixture, no `$schema`, and no
`additionalProperties`; `target.kind` carries
`"enum": ["file", "export"]` identically in both.

## Tools implemented (1)

- `plan_rename` — arguments: `target` (object, required:
  `kind` required, one of `"file"` or `"export"`; `name`
  required, non-empty; `module` optional in the schema,
  required and non-empty for kind export, validated as a
  string and otherwise ignored for kind file) and
  `modules` (array, required, at least 1 item; each item
  `path` required non-empty, `imports` optional with each
  item's `from` required non-empty and `names` optional,
  `exports` optional, `dynamic_imports` optional).
  Required is exactly `["target", "modules"]` at the top
  level, `["kind", "name"]` inside `target`, `["path"]`
  inside a module item, and `["from"]` inside an import item.

  File kind (P = target.name) is pinned: a direct
  referencer is a module other than P that statically
  imports P and/or lists P in `dynamic_imports`, with
  `kinds` in static-then-dynamic order. Indirect
  referencers are found by breadth-first expansion from P
  over reverse static edges (level 1 = static direct
  referencers; level >= 2 = indirect; a dynamic edge
  therefore never carries a chain). An indirect module's
  `via` is the module it statically imports that lies one
  level closer to P, ties broken to the qualifying module
  that appears first in the modules input order.

  Export kind (M = target.module, E = target.name) is
  pinned: a direct referencer imports E from M over a
  named-binding edge (`names` includes E on an import from
  M) and has `kinds` `["static"]`; `names` absent means no
  named bindings, so a namespace-style import is not a
  reference, and neither is importing a different name or
  dynamically importing M. Indirect referencers follow the
  same BFS over named-binding edges for E, following
  re-export chains only: an edge into a module counts only
  when that module itself exports E, so importing E from a
  non-re-exporting direct referencer — or from a module
  that exports E independently, outside the chain — counts
  nowhere. `via` follows the same first-in-input-order rule.

  Returns `{target, direct, indirect, edit_order, flags,
  counts}`, where `target` is `{kind, name, module}`
  (`module` is the supplied module for kind export and
  null for kind file), `direct` is a list of `{path,
  kinds}`, `indirect` is a list of `{path, via}`, both
  sorted by path code-unit ascending, `edit_order` is the
  direct paths in sorted order, then the indirect paths in
  sorted order, then the target module's path last, `flags`
  is in the pinned order `dynamic_reference` (file kind,
  some direct referencer is dynamic), `reexport_chain`
  (export kind, some direct referencer re-exports E),
  `wide_blast_radius` (direct + indirect >= 10), and
  `counts` is `{direct, indirect, total_affected}` with
  `total_affected` = direct + indirect.

## Implementation notes

- `src/mcp.ts` uses the SDK's low-level `Server` with an
  explicit inputSchema literal exactly matching the
  fixture, per the standing fleet rule (no McpServer/zod
  schema conversion). Every `tools/call` is validated by
  the core itself, so the MCP and CLI paths share one
  validation implementation; the core takes the full
  arguments object.
- Validation is path-naming and total: a malformed target,
  module, import, export, or dynamic-import entry throws an
  Error naming the offending path (e.g.
  `modules[1].imports[0].from must be a non-empty string`)
  and produces no partial result (MCP: `isError`; CLI:
  exit 1). A duplicate module path throws
  `duplicate module path: <path>`; target resolution throws
  `target module not found: <name-or-module>` or
  `export not found: <name> in <module>`. Unknown extra
  fields are ignored, including inside items; a non-object
  top-level argument is treated as {}.
- Both BFS expansions share one helper: levels are computed
  once from the target over the relevant reverse-edge map,
  and `via` is then selected from a module's own imports by
  the level-minus-one test plus the input-order tie-break,
  so the two pinned judgement calls are implemented in
  exactly one place each.
- For the export graph, the reverse-edge map is built only
  from named-binding edges whose imported-from module
  exports E. That single construction implements both the
  re-export-chain rule and the counts-nowhere rule: an edge
  into a non-exporter is never added, so no chain passes
  through it and no importer is discovered through it.

## Verification (foreground, this session)

- `npm test` (`tsx --test test/*.test.ts`): **59 tests,
  59 pass, 0 fail** — file kind: static-only, dynamic-only
  (kinds `["dynamic"]`, `dynamic_reference` flag), and
  both-kinds (`["static", "dynamic"]` order) direct
  referencers; an empty-names static import still counting
  for a file; a 3-level chain with level-2 and level-3
  indirect referencers and correct vias; the diamond via
  judgement call (first in modules input order wins over
  both import-list order and path sort, as a dedicated
  test, for both kinds); via restricted to one level
  closer on a longer alternative path; a dynamic edge not
  carrying a chain; a direct referencer never duplicated
  as indirect; an unrelated cycle producing nothing; a
  target with no referencers (empty lists, no flags,
  `edit_order` of just the target); a self-import by the
  target itself ignored for both kinds; code-unit sorting
  (uppercase before lowercase) for direct and indirect;
  `edit_order` composition (direct sorted, indirect
  sorted, target last, not a global sort); the
  wide_blast_radius boundary at 9 vs 10, its direct-plus-
  indirect counting, and the pinned flag order
  `["dynamic_reference", "wide_blast_radius"]` and
  `["reexport_chain", "wide_blast_radius"]`; export kind:
  direct via named binding, a namespace import (names
  absent) not a reference, a different-name import not a
  reference, the name among several names, a dynamic
  import never referencing an export, a re-export chain
  (indirect via = the re-exporter, `reexport_chain` flag),
  a transitive chain to level 3, the counts-nowhere
  judgement call for a non-re-exporting direct referencer
  (dedicated test), a chain breaking at a non-re-exporting
  link, and an independent exporter outside the chain
  counting nowhere; target resolution (file target not
  found, export defining module not found, export not
  found, export module field missing); a duplicate module
  path; kind file with a string module field ignored with
  output module null; and every validation path (target
  missing / not an object, kind missing / outside the
  enum, name missing / empty / non-string, module
  non-string for file and missing / empty / non-string for
  export, modules missing / not an array / empty, module
  item not an object, path missing / empty / non-string,
  imports not an array, import item not an object, import
  `from` missing / empty / non-string, import `names` not
  an array / containing a non-string, exports and
  dynamic_imports not an array / containing a non-string,
  all with deep paths, a non-object top-level treated as
  {}, unknown extras ignored inside items, and no partial
  result). One test initially failed on a test-side bug
  (the code-unit sorting case ran through a helper pinned
  to a different target path); the test was fixed to name
  its own target and the full suite re-ran green — the
  core was not at fault.
- `npx tsc --noEmit` → exit 0; `npm run build` produced
  `dist/` with all 15 outputs.
- `dist/cli.js --version` → `0.1.0`; unknown command exits
  2 with usage; `plan` with no `--input` exits 2;
  `plan --input <missing file>` exits 1 naming the file;
  `plan --input <valid file>` exits 0 and prints the
  hand-checked export-chain result (direct `src/x.ts`,
  indirect `src/y.ts` via `src/x.ts`, flags
  `["reexport_chain"]`, counts 1/1/2) for an export of
  `foo` from `src/def.ts` re-exported by `src/x.ts` and
  imported by `src/y.ts`; `plan --input <invalid file>`
  (an import with an empty `from`) exits 1 with
  `modules[1].imports[0].from must be a non-empty string`.
- Parity: `harness/parity.py` vs
  `harness/fixtures/renameplan-tools-original.json` →
  **PASS, parity 100.0, identical_tools 1/1** (run with
  the rebuild path as an absolute path; the harness does
  not expand a `~` inside the quoted stdio command
  string). Report saved under `parity-out/`.

## Lockfile status

`package-lock.json` generated clean via Route 3 (in the
build directory with no `node_modules` present, offline
`npm install --package-lock-only --ignore-scripts
--offline`), verified: parses, name
`@reneturcios/renameplan`, **128 package entries**. The
subsequent offline `npm install --ignore-scripts
--offline`, build, tests, and parity all ran against this
lockfile's tree.

## Gaps / honest notes

- **Pinned judgement calls** (each with a dedicated
  test): (1) the `via` tie-break is the modules **input
  order** of the qualifying module, not the order the
  indirect module lists its imports and not path sort —
  the diamond tests deliberately make all three orders
  disagree (the winner sorts last and is listed last) so
  only the pinned rule passes; (2) an import of an export
  name from a module that does not export that name counts
  nowhere, even when that module is itself a direct
  referencer, and a chain breaks at a non-re-exporting
  link even if a later module re-exports; (3) a dynamic
  edge makes a file referencer direct but does not
  propagate indirect reachability, because the spec scopes
  indirect reachability to two or more **static** edges;
  (4) kind file with a `module` field present validates it
  as a string, ignores it, and echoes `module: null`;
  (5) `names`, `exports`, and `dynamic_imports` entries
  are validated as strings only — the spec pins a
  non-empty rule only for `path`, `from`, `target.name`,
  and (for kind export) `target.module`, so an empty-string
  entry in those lists is accepted and simply never
  matches a real target; (6) error-message wording follows
  the fleet's path-naming pattern (e.g. `target.kind must
  be one of "file" or "export"`,
  `modules must contain at least 1 item`).
- **Spec ambiguity found:** the spec's parenthetical
  "(level 1 = direct referencers; level >= 2 = indirect)"
  for the file BFS is exact for static direct referencers
  but a dynamic-only direct referencer sits at no BFS level
  at all, since the expansion runs over reverse **static**
  edges only. Pinned as read: BFS levels come from static
  edges alone, direct referencers (static and/or dynamic)
  are excluded from indirect by the direct set, and a
  module reachable only through a dynamic edge is never
  indirect. This reading is the only one consistent with
  the spec's own definition of indirect ("reachable
  through two or more static edges") and is pinned by the
  dynamic-chain and direct-never-indirect tests. No other
  spec ambiguity was found.
- Container build not exercised locally; the
  publish-container workflow smoke-tests the image at
  publish time.
- Nothing pushed or published; this is a local build only.
