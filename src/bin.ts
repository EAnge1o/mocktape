#!/usr/bin/env node
import { runCli } from "./cli.js";

runCli(process.argv).catch((error: Error) => {
  console.error(`✖ ${error.message}`);
  process.exit(1);
});
