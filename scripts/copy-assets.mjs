import { cp, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const target = path.join(root, "dist", "dashboard", "public");
await mkdir(target, { recursive: true });
await cp(path.join(root, "src", "dashboard", "public"), target, { recursive: true });
console.log("dashboard assets → dist/dashboard/public");
