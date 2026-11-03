# renameplan

Renaming a file or an export is easy to start and easy to
get wrong: the module you can see importing it is rarely
the whole story. renameplan makes you look at the whole
story first. You supply a module graph — each module's
path, its static imports with any named bindings, the
names it exports, and the paths it imports dynamically —
plus the file or export you want to rename, and it returns
every direct referencer, every indirect referencer, a
safe order to edit them in, and the risk flags that should
slow you down. It returns the plan only; nothing is read,
renamed, or executed.

For a file target, a direct referencer is a module that
imports the target statically, dynamically, or both; its
`kinds` list says which, static first. Indirect
referencers are modules that reach the target through two
or more static edges, found by walking the graph outward
from the target over reverse static edges. Each indirect
referencer names a `via`: the module it imports that sits
one step closer to the target. When several of its imports
qualify, the `via` is the one that appears first in the
order you supplied the modules, so the answer is stable
for a given graph. A dynamic import makes a module a
direct referencer of a file, but dynamic edges do not
carry a chain further — a module that statically imports a
dynamic-only referencer is not, by that path alone, an
indirect referencer.

For an export target, only named bindings count. A module
that imports the defining module without naming the
export, or that imports a different name from it, is not a
referencer at all, and neither is a dynamic import.
Indirect referencers arrive through re-export chains: if
a direct referencer re-exports the name, a module that
imports the name from that referencer is an indirect
referencer, and the chain can continue through further
re-exporters. The mirror rule is strict: importing the
name from a module that does not itself export it counts
nowhere, even if that module imports the name from
somewhere in the chain.

The plan is deliberately mechanical to read. Direct and
indirect referencers are each sorted by path in code-unit
order. `edit_order` lists the direct paths, then the
indirect paths, then the target module last, so you work
inward toward the thing being renamed. Flags arrive in a
fixed order: `dynamic_reference` when a file is referenced
dynamically, `reexport_chain` when an export is re-exported
by a direct referencer, and `wide_blast_radius` when ten
or more modules are affected in total.

Malformed input — a missing target, a `kind` other than
`file` or `export`, an empty name or path, a duplicate
module path, a badly typed import, export, or dynamic
import entry, a target module that is not in the graph, or
an export the defining module does not export — is an
error naming the offending path, with no partial plan.
Unknown extra fields are ignored, including inside items.

## CLI

```bash
npx @reneturcios/renameplan plan --input args.json
npx @reneturcios/renameplan --version
```

`args.json` contains the full arguments object:

```json
{
  "target": { "kind": "file", "name": "src/util.ts" },
  "modules": [
    { "path": "src/util.ts", "exports": ["help"] },
    {
      "path": "src/app.ts",
      "imports": [{ "from": "src/util.ts", "names": ["help"] }]
    },
    {
      "path": "src/page.ts",
      "imports": [{ "from": "src/app.ts" }]
    }
  ]
}
```

The result is printed as JSON:

```json
{
  "target": { "kind": "file", "name": "src/util.ts", "module": null },
  "direct": [{ "path": "src/app.ts", "kinds": ["static"] }],
  "indirect": [{ "path": "src/page.ts", "via": "src/app.ts" }],
  "edit_order": ["src/app.ts", "src/page.ts", "src/util.ts"],
  "flags": [],
  "counts": { "direct": 1, "indirect": 1, "total_affected": 2 }
}
```

Exit codes: `0` on success, `1` on a runtime error
(including an unreadable or invalid input file, or invalid
input), `2` on a usage error.

## MCP server

```bash
npx -y @reneturcios/renameplan mcp
```

MCP client config:

```json
{
  "mcpServers": {
    "renameplan": {
      "command": "npx",
      "args": ["-y", "@reneturcios/renameplan", "mcp"]
    }
  }
}
```

### Tools

- `plan_rename` — Plan a safe file or export rename from a
  caller-supplied module graph.
  - `target` (object, required) — the file or export to
    rename
    - `kind` (string, required) — `"file"` or `"export"`
    - `name` (string, required, non-empty) — for kind
      file: the module path; for kind export: the export
      name
    - `module` (string, optional in the schema) — module
      defining the export; required for kind export
  - `modules` (array, required, at least 1 item) — the
    module graph
    - `path` (string, required, non-empty) — module path
    - `imports` (array, optional) — static imports; each
      item has `from` (string, required, non-empty) and
      `names` (array of strings, optional; absent means no
      named bindings)
    - `exports` (array of strings, optional) — names this
      module exports
    - `dynamic_imports` (array of strings, optional) —
      module paths this module imports dynamically

  Returns `{target, direct, indirect, edit_order, flags,
  counts}`, where `target` is `{kind, name, module}`
  (`module` is null for kind file), `direct` is a list of
  `{path, kinds}`, `indirect` is a list of `{path, via}`,
  and `counts` is `{direct, indirect, total_affected}`.

## Docker

```bash
docker run -i ghcr.io/cloudcorprecords/renameplan
docker run --rm -v "$PWD:/w" ghcr.io/cloudcorprecords/renameplan plan --input /w/args.json
```

## Development

```bash
npm install
npm run build   # tsc -> dist/
npm test        # tsx --test test/*.test.ts (pure local, no network)
npm run dev     # run the CLI from source
```

## License

MIT — Copyright (c) 2026 Rene Turcios
