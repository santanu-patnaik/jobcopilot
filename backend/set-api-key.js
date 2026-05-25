#!/usr/bin/env node
/**
 * JobPilot — One-time API key setup
 * Usage: node backend/set-api-key.js sk-ant-api03-...
 */
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT      = path.resolve(__dirname, "..");
const DATA_DIR  = path.join(ROOT, "data");
const KEY_FILE  = path.join(DATA_DIR, "api_keys.json");
const GITIGNORE = path.join(ROOT, ".gitignore");

const key = process.argv[2];

if (!key) {
  console.log("\nUsage: node backend/set-api-key.js sk-ant-api03-...\n");
  console.log("Get your key at: https://console.anthropic.com/settings/keys\n");
  process.exit(1);
}

if (!key.startsWith("sk-ant-")) {
  console.log("\nError: Key should start with sk-ant-");
  console.log("Get your key at: https://console.anthropic.com/settings/keys\n");
  process.exit(1);
}

// Create data dir
fs.mkdirSync(DATA_DIR, { recursive: true });

// Save key
fs.writeFileSync(KEY_FILE, JSON.stringify({ anthropic: key }, null, 2), "utf8");
console.log(`\n✓ API key saved to data/api_keys.json`);

// Make sure data/ is in .gitignore so key is never committed
const ignore = fs.existsSync(GITIGNORE) ? fs.readFileSync(GITIGNORE, "utf8") : "";
if (!ignore.includes("data/")) {
  fs.appendFileSync(GITIGNORE, "\n# Local data — contains API keys, never commit\ndata/\n");
  console.log("✓ Added data/ to .gitignore");
}

console.log("\nYou can now run: npm run scan:me\n");
