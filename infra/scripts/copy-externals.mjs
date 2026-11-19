// Copies the given packages plus their transitive runtime dependencies from a hoisted node_modules.
import { cpSync, existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const [from, to, ...roots] = process.argv.slice(2);
const seen = new Set();
const queue = [...roots];
while (queue.length) {
  const name = queue.pop();
  if (seen.has(name)) continue;
  const dir = join(from, name);
  if (!existsSync(dir)) continue;
  seen.add(name);
  const pkg = JSON.parse(readFileSync(join(dir, "package.json"), "utf8"));
  queue.push(...Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }));
  cpSync(dir, join(to, name), { recursive: true, dereference: true });
}
console.log(`copied ${seen.size} packages: ${[...seen].sort().join(" ")}`);
