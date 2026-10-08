import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const source = await readFile(path.join(ROOT, "apps/web/src/app/page.tsx"), "utf8");
const homeMatch = source.match(/export default function Home\(\)\s*\{([\s\S]*)/);
assert.ok(homeMatch, "expected the Home component to exist");
const home = homeMatch[1];

test("Home no longer sets or renders fabricated transaction statistics", () => {
  assert.doesNotMatch(home, /\b(?:liveStats|setLiveStats)\b/);
  assert.doesNotMatch(home, /\b(?:agents|transactions)\s*:\s*\d+/);
  assert.doesNotMatch(home, /\btxns\b/);
});

test("Home no longer fetches discovery to infer counts or retains its effect", () => {
  assert.doesNotMatch(home, /\bfetch\s*\(/);
  assert.doesNotMatch(source, /\buseEffect\b/);
});

test("Home retains the API location badge", () => {
  assert.match(home, /<div\b[^>]*>\s*<span\b[^>]*\/>\s*API live at \/api\/v1\s*<\/div>/);
});

test("Home retains TerminalDemo and its interactive controls", () => {
  assert.match(home, /<TerminalDemo\s*\/>/);
  assert.match(source, /function TerminalDemo\(\)/);
  assert.match(source, /onClick=\{\(\) => simulateStep\(step\)\}/);
  assert.match(source, /import\s*\{\s*useState\s*\}\s*from\s*"react"/);
});
