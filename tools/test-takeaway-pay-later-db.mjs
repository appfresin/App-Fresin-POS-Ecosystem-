import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";

const root = fileURLToPath(new URL("../", import.meta.url));
const project = process.argv.find(arg => arg.startsWith("--remote="))?.slice(9);
const linked = fs.readFileSync(path.join(root, "supabase/.temp/project-ref"), "utf8").trim();
if (!project || !/^[a-z0-9]+$/.test(project) || project !== linked) {
  throw new Error("Pass --remote=<linked-project-ref> explicitly. Only temporary fixtures will be changed.");
}

const read = relative => fs.readFileSync(path.join(root, relative), "utf8");
const migration = read("supabase/migrations/20261108105658_guard_takeaway_pay_later.sql")
  .replace(/^begin;\s*/i, "").replace(/commit;\s*$/i, "").replaceAll("public.", "pg_temp.");
const sql = ["begin;", read("tests/takeaway-pay-later-db-fixture.sql"), migration,
  read("tests/takeaway-pay-later-db-assertions.sql"), "rollback;"].join("\n");
const temporary = path.join(os.tmpdir(), `codex-takeaway-guard-${randomUUID()}.sql`);
fs.writeFileSync(temporary, sql);
try {
  const args = ["--yes", "supabase", "db", "query", `--remote=${project}`, "--yes", "--file", temporary];
  const result = process.platform === "win32"
    ? spawnSync(`npx ${args.map(arg => `"${arg}"`).join(" ")}`, { cwd: root, shell: true, stdio: "inherit" })
    : spawnSync("npx", args, { cwd: root, stdio: "inherit" });
  if (result.error) throw result.error;
  process.exitCode = result.status ?? 1;
} finally {
  fs.unlinkSync(temporary);
}
