#!/usr/bin/env node
/**
 * twitterapi.io MCP server — stdio transport entry.
 *
 * Spawned by MCP clients (Claude Desktop, Cursor, VS Code, Claude Code) via npx.
 * Reads TWITTERAPI_IO_API_KEY from env (injected by client config).
 *
 * Spec compliance: 2025-11-25.
 * Distribution: npm `@twitterapi-io/mcp-server`.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { TOOLS } from "./tools.js";
import { TwitterApiError } from "./twitterapi-client.js";

// Convert zod schema to JSON Schema (MCP tool inputSchema format)
// zod's built-in toJSON isn't standardized; we hand-roll a minimal converter
// covering the shapes our 12 tools use (string, number, boolean, enum, optional).
function zodToJsonSchema(schema: z.ZodObject<any>): unknown {
  const shape = schema.shape;
  const properties: Record<string, unknown> = {};
  const required: string[] = [];

  for (const [key, value] of Object.entries(shape)) {
    const v = value as z.ZodTypeAny;
    properties[key] = zodFieldToJsonSchema(v);
    if (!v.isOptional()) required.push(key);
  }

  const out: Record<string, unknown> = {
    type: "object",
    properties,
  };
  if (required.length > 0) out.required = required;
  return out;
}

function zodFieldToJsonSchema(field: z.ZodTypeAny): unknown {
  // unwrap optional
  let inner = field;
  if (inner instanceof z.ZodOptional) {
    inner = inner._def.innerType;
  }
  // unwrap default
  if (inner instanceof z.ZodDefault) {
    inner = inner._def.innerType;
  }

  const description = field.description;

  if (inner instanceof z.ZodEnum) {
    return {
      type: "string",
      enum: inner._def.values,
      ...(description ? { description } : {}),
    };
  }
  if (inner instanceof z.ZodString) {
    return { type: "string", ...(description ? { description } : {}) };
  }
  if (inner instanceof z.ZodNumber) {
    const def: any = { type: "number" };
    // ZodNumber may have int / min / max checks
    const checks = (inner._def as any).checks || [];
    for (const c of checks) {
      if (c.kind === "int") def.type = "integer";
      if (c.kind === "min") def.minimum = c.value;
      if (c.kind === "max") def.maximum = c.value;
    }
    if (description) def.description = description;
    return def;
  }
  if (inner instanceof z.ZodBoolean) {
    return { type: "boolean", ...(description ? { description } : {}) };
  }
  // fallback
  return { type: "string", ...(description ? { description } : {}) };
}

async function main(): Promise<void> {
  // Verify API key on startup so user gets a clear error
  if (!process.env.TWITTERAPI_IO_API_KEY) {
    console.error(
      "ERROR: TWITTERAPI_IO_API_KEY env var is required.\n" +
        "Get a free API key at https://twitterapi.io and add it to your MCP client config.\n" +
        "Example for Claude Desktop (~/Library/Application Support/Claude/claude_desktop_config.json):\n" +
        '{ "mcpServers": { "twitterapi-io": { "command": "npx", "args": ["-y", "@twitterapi-io/mcp-server"], "env": { "TWITTERAPI_IO_API_KEY": "your_key_here" } } } }',
    );
    process.exit(1);
  }

  const server = new Server(
    {
      name: "twitterapi-io",
      version: "0.1.0",
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  // List tools
  server.setRequestHandler(ListToolsRequestSchema, async () => ({
    tools: TOOLS.map((t) => ({
      name: t.name,
      description: t.description,
      inputSchema: zodToJsonSchema(t.inputSchema),
    })),
  }));

  // Call tool
  server.setRequestHandler(CallToolRequestSchema, async (req) => {
    const toolName = req.params.name;
    const tool = TOOLS.find((t) => t.name === toolName);
    if (!tool) {
      return {
        isError: true,
        content: [{ type: "text", text: `Unknown tool: ${toolName}` }],
      };
    }

    const rawArgs = req.params.arguments ?? {};
    let validated: Record<string, unknown>;
    try {
      validated = tool.inputSchema.parse(rawArgs);
    } catch (e) {
      const msg = e instanceof z.ZodError ? JSON.stringify(e.errors) : String(e);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `Invalid arguments for ${toolName}: ${msg}`,
          },
        ],
      };
    }

    try {
      const result = await tool.call(validated);
      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(result, null, 2),
          },
        ],
      };
    } catch (e) {
      const msg =
        e instanceof TwitterApiError
          ? `${e.message} (path=${e.path})`
          : (e as Error).message;
      console.error(`[twitterapi-mcp] tool ${toolName} failed:`, msg);
      return {
        isError: true,
        content: [
          {
            type: "text",
            text: `twitterapi.io call failed: ${msg}`,
          },
        ],
      };
    }
  });

  // Connect stdio transport
  const transport = new StdioServerTransport();
  await server.connect(transport);
  console.error(
    `[twitterapi-mcp] server started — ${TOOLS.length} tools registered, stdio transport ready`,
  );
}

main().catch((e) => {
  console.error("[twitterapi-mcp] fatal:", e);
  process.exit(1);
});
