/**
 * renameplan types.
 *
 * renameplan plans a safe rename of one file or one export
 * from a caller-supplied module graph. The caller supplies
 * a target and the graph: each module's path, its static
 * imports (with optional named bindings), the names it
 * exports, and the module paths it imports dynamically.
 * From that data alone, as pure local computation,
 * renameplan reports:
 *
 *   - the direct referencers, with their reference kinds
 *   - the indirect referencers, with the module each one
 *     reaches the target through
 *   - a safe edit order: direct referencers first, then
 *     indirect referencers, then the target last
 *   - risk flags, in a pinned order
 *   - counts of direct, indirect, and total affected
 *
 * For a file target, direct referencers import the target
 * statically and/or dynamically, and indirect referencers
 * reach it through two or more static edges. For an export
 * target, direct referencers import the name from its
 * defining module, and indirect referencers import the
 * name through a chain of referencers that re-export it.
 */

/** Whether the rename target is a file or an export. */
export type TargetKind = "file" | "export";

/** A reference kind on a direct referencer. */
export type ReferenceKind = "static" | "dynamic";

/** A risk flag, in the pinned output order. */
export type RenameFlag =
  | "dynamic_reference"
  | "reexport_chain"
  | "wide_blast_radius";

/** The target as echoed in a result. */
export interface RenameTarget {
  /** Whether the target is a file or an export. */
  kind: TargetKind;
  /** For kind file: the module path. For kind export: the export name. */
  name: string;
  /** Module defining the export, or null for kind file. */
  module: string | null;
}

/** A module that references the target directly. */
export interface DirectReferencer {
  /** Module path. */
  path: string;
  /** Reference kinds, "static" first when both apply. */
  kinds: ReferenceKind[];
}

/** A module that references the target indirectly. */
export interface IndirectReferencer {
  /** Module path. */
  path: string;
  /** The module this module imports that lies one level closer to the target. */
  via: string;
}

/** Referencer counts in a result. */
export interface RenameCounts {
  /** Number of direct referencers. */
  direct: number;
  /** Number of indirect referencers. */
  indirect: number;
  /** direct + indirect. */
  total_affected: number;
}

/** The rename plan for one target. */
export interface RenamePlanResult {
  /** The target, echoed in output shape. */
  target: RenameTarget;
  /** Direct referencers, sorted by path, code-unit ascending. */
  direct: DirectReferencer[];
  /** Indirect referencers, sorted by path, code-unit ascending. */
  indirect: IndirectReferencer[];
  /** Direct paths, then indirect paths, then the target module's path last. */
  edit_order: string[];
  /** Risk flags, in the pinned order. */
  flags: RenameFlag[];
  /** Referencer counts. */
  counts: RenameCounts;
}
