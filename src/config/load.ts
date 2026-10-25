import path from "node:path";
import { pathToFileURL } from "node:url";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import YAML from "yaml";
import { parseConfig, ConfigValidationError, type MocktapeConfig } from "./schema.js";

export const CONFIG_BASENAMES = [
  "mocktape.json",
  "mocktape.yaml",
  "mocktape.yml",
  "mocktape.config.json",
  "mocktape.config.yaml",
  "mocktape.config.yml",
  "mocktape.config.js",
  "mocktape.config.mjs",
];

export const CONFIG_FILES_HINT = "mocktape.json";

/**
 * Find the closest config file, walking up from `cwd` to the filesystem root —
 * same convention as .editorconfig, so monorepo subdirectories just work.
 */
export function findConfigFile(fromDir: string = process.cwd()): string | undefined {
  let current = path.resolve(fromDir);
  while (true) {
    for (const name of CONFIG_BASENAMES) {
      const candidate = path.join(current, name);
      if (existsSync(candidate)) return candidate;
    }
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

/**
 * Load and validate a config file. Supports JSON, YAML and JS/MJS (which may
 * export the config synchronously or as a promise).
 */
export async function loadConfigFile(
  filePath: string,
  overrides: Partial<MocktapeConfig> = {},
): Promise<{ config: MocktapeConfig; filePath: string; source: unknown }> {
  const absolute = path.resolve(filePath);
  const ext = path.extname(absolute).toLowerCase();
  let source: unknown;

  if (ext === ".js" || ext === ".mjs") {
    if (!existsSync(absolute)) {
      throw new ConfigValidationError(`config file not found: ${absolute}`, []);
    }
    const mod = await import(pathToFileURL(absolute).href);
    source = mod.default ?? mod.config ?? mod;
  } else {
    if (!existsSync(absolute)) {
      throw new ConfigValidationError(`config file not found: ${absolute}`, []);
    }
    const text = await readFile(absolute, "utf8");
    if (text.trim() === "") {
      source = {};
    } else if (ext === ".yaml" || ext === ".yml") {
      source = YAML.parse(text);
    } else {
      try {
        source = JSON.parse(text);
      } catch (error) {
        throw new ConfigValidationError(
          `${path.basename(absolute)} is not valid JSON: ${(error as Error).message}`,
          [],
        );
      }
    }
  }

  return {
    config: parseConfig({ ...(source as object), ...stripUndefined(overrides) }),
    filePath: absolute,
    source,
  };
}

function stripUndefined(overrides: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== undefined));
}

/** Validate an inline config object (library mode). */
export function loadConfig(input: unknown): MocktapeConfig {
  return parseConfig(input);
}
