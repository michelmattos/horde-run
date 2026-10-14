// Claude Code PostToolUse hook (see .claude/settings.json). After an agent edits a file it
// formats the file with oxfmt and lints it with oxlint, so formatting never drifts and
// lint errors come straight back to the agent (exit 2 shows stderr to Claude) instead of
// surfacing later in CI.
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { relative } from 'node:path';

const input = JSON.parse(readFileSync(0, 'utf8'));
const file = input.tool_input?.file_path;
const root = process.env.CLAUDE_PROJECT_DIR || process.cwd();
if (!file) process.exit(0);
const rel = relative(root, file);
if (rel.startsWith('..') || /^(node_modules|dist|public)\//.test(rel)) process.exit(0);

const run = (cmd, args) => spawnSync(cmd, args, { cwd: root, encoding: 'utf8' });

if (/\.(ts|mjs|js|json|css|html|md|ya?ml)$/.test(rel)) {
  run('npx', ['oxfmt', '--no-error-on-unmatched-pattern', rel]);
}
if (/\.(ts|mjs|js)$/.test(rel)) {
  const lint = run('npx', ['oxlint', '--type-aware', '--deny-warnings', rel]);
  if (lint.status !== 0) {
    process.stderr.write(`oxlint found problems in ${rel}; fix them:\n${lint.stdout}${lint.stderr}`);
    process.exit(2);
  }
}
