#!/usr/bin/env node
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { readConfiguration } from "./configuration.mjs";
import { createServer } from "./server.mjs";

const server = createServer(readConfiguration());
await server.connect(new StdioServerTransport());
process.stdin.once("end", () => server.close());
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, async () => {
    await server.close();
    process.exit(0);
  });
