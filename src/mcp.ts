/**
 * renameplan MCP server. Tools: plan_rename.
 *
 * Why the low-level Server instead of McpServer: the high-level
 * helper converts zod schemas to JSON Schema and injects keys
 * not in this tool's defined spec ("$schema" and
 * "additionalProperties"), which breaks exact tool-list/schema
 * parity with the spec. This file serves tools/list with the
 * spec's exact input schema as an explicit literal, and every
 * tools/call is validated by the core, which names the
 * offending path on invalid input.
 *
 * The computation is pure and local: no upstream API, no
 * authentication, and no configuration — the caller supplies
 * the whole module graph the plan is based on.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { formatPayload, planRename, VERSION } from "./renameplan.js";

const TOOLS = [
  {
    name: "plan_rename",
    description:
      "Plan a safe file or export rename from a caller-supplied module graph: every module that references the target, the reference kinds, indirect references through the graph, a safe edit order, and risk flags. Returns the plan only; nothing is read, renamed, or executed.",
    inputSchema: {
      type: "object" as const,
      properties: {
        modules: {
          type: "array",
          description: "The module graph",
          items: {
            type: "object",
            properties: {
              dynamic_imports: {
                type: "array",
                description: "Module paths this module imports dynamically",
                items: { type: "string" },
              },
              exports: {
                type: "array",
                description: "Names this module exports",
                items: { type: "string" },
              },
              imports: {
                type: "array",
                description: "Static imports of this module",
                items: {
                  type: "object",
                  properties: {
                    from: {
                      type: "string",
                      description: "Path of the imported module",
                    },
                    names: {
                      type: "array",
                      description:
                        "Named bindings imported from the module; absent means the module is imported with no named bindings (optional)",
                      items: { type: "string" },
                    },
                  },
                  required: ["from"],
                },
              },
              path: {
                type: "string",
                description: "Module path",
              },
            },
            required: ["path"],
          },
        },
        target: {
          type: "object",
          description: "The file or export to rename",
          properties: {
            kind: {
              type: "string",
              description: "Whether the target is a file or an export",
              enum: ["file", "export"],
            },
            module: {
              type: "string",
              description: "Module defining the export (required for kind export)",
            },
            name: {
              type: "string",
              description:
                "For kind file: the module path. For kind export: the export name",
            },
          },
          required: ["kind", "name"],
        },
      },
      required: ["target", "modules"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [
      {
        type: "text" as const,
        text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
      },
    ],
  };
}

function errorResult(err: unknown) {
  return {
    content: [
      { type: "text" as const, text: err instanceof Error ? err.message : String(err) },
    ],
    isError: true,
  };
}

const server = new Server(
  { name: "renameplan", version: VERSION },
  { capabilities: { tools: {} } },
);

server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));

server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  try {
    let out: unknown;
    if (name === "plan_rename") {
      out = planRename(args ?? {});
    } else {
      throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
    }
    return textResult(formatPayload(out));
  } catch (err) {
    if (err instanceof McpError) throw err;
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}

void main();
