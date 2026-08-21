#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const MAX_FILES = 5000;
const MAX_FILE_BYTES = 512_000;
const TEXT_EXTENSIONS = new Set(['.md','.json','.jsonc','.yaml','.yml','.toml','.js','.mjs','.cjs','.ts','.tsx','.jsx','.py','.sh','.bash','.zsh','.ps1','.cmd','.bat','.env','.txt']);
const SKIP_DIRS = new Set(['.git','node_modules','vendor','dist','build','coverage','.next','.cache']);

export function scanRepository(rootInput, options = {}) {
  const root = path.resolve(String(rootInput || '.'));
  const maxFiles = Math.max(1, Math.min(Number(options.maxFiles) || MAX_FILES, MAX_FILES));
  const files = [];
  walk(root, root, files, maxFiles);

  const findings = [];
  const inventory = {
    files_scanned: 0,
    license_files: [],
    agent_files: [],
    hook_files: [],
    mcp_files: [],
    workflow_files: [],
    shell_files: [],
    package_manifests: [],
    skill_files: [],
  };

  for (const rel of files) {
    const abs = path.join(root, rel);
    const lower = rel.toLowerCase();
    const ext = path.extname(lower);
    const base = path.basename(lower);

    if (/^(license|license\.|copying|copying\.)/.test(base)) inventory.license_files.push(rel);
    if (base === 'agents.md' || lower.includes('/agents/') || lower.startsWith('agents/')) inventory.agent_files.push(rel);
    if (lower.includes('/hooks/') || lower.startsWith('hooks/') || base.includes('hook')) inventory.hook_files.push(rel);
    if (base === '.mcp.json' || /mcp.*\.(json|jsonc|yaml|yml|toml)$/.test(base)) inventory.mcp_files.push(rel);
    if (lower.startsWith('.github/workflows/') || lower.includes('/.github/workflows/')) inventory.workflow_files.push(rel);
    if (['.sh','.bash','.zsh','.ps1','.cmd','.bat'].includes(ext)) inventory.shell_files.push(rel);
    if (base === 'package.json' || base === 'pyproject.toml' || base === 'requirements.txt' || base === 'cargo.toml' || base === 'go.mod') inventory.package_manifests.push(rel);
    if (base === 'skill.md' || lower.includes('/skills/')) inventory.skill_files.push(rel);

    let stat;
    try { stat = fs.lstatSync(abs); } catch { continue; }
    if (!stat.isFile() || stat.size > MAX_FILE_BYTES || (!TEXT_EXTENSIONS.has(ext) && !['license','copying','agents.md','.mcp.json','package.json'].includes(base))) continue;

    let text;
    try { text = fs.readFileSync(abs, 'utf8'); } catch { continue; }
    inventory.files_scanned += 1;
    inspectText(rel, text, findings);
  }

  const deduped = dedupeFindings(findings);
  return {
    scanner: 'factory-repository-intake-static-v1',
    mode: 'STATIC_ONLY_NO_DONOR_EXECUTION',
    root,
    inventory,
    findings: deduped,
    summary: {
      total_findings: deduped.length,
      critical: deduped.filter((x) => x.severity === 'CRITICAL').length,
      high: deduped.filter((x) => x.severity === 'HIGH').length,
      medium: deduped.filter((x) => x.severity === 'MEDIUM').length,
      low: deduped.filter((x) => x.severity === 'LOW').length,
      executable_surfaces_present: inventory.hook_files.length > 0 || inventory.mcp_files.length > 0 || inventory.shell_files.length > 0,
    },
  };
}

function inspectText(rel, text, findings) {
  const lowerPath = rel.toLowerCase();

  if (lowerPath.endsWith('package.json')) {
    try {
      const pkg = JSON.parse(text);
      const scripts = pkg?.scripts || {};
      for (const name of ['preinstall','install','postinstall','prepare']) {
        if (typeof scripts[name] === 'string' && scripts[name].trim()) {
          findings.push(finding(rel, 'package-lifecycle-script', 'HIGH', `${name}: ${clip(scripts[name], 240)}`));
        }
      }
    } catch {
      findings.push(finding(rel, 'manifest-parse-failure', 'LOW', 'package.json could not be parsed during static intake'));
    }
  }

  const rules = [
    ['pipe-to-shell', /(?:curl|wget)[^\n|]{0,300}\|\s*(?:sh|bash|zsh|powershell|pwsh)\b/i, 'CRITICAL'],
    ['destructive-shell', /\brm\s+-rf\s+(?:\/|~|\$HOME|\.)/i, 'HIGH'],
    ['dynamic-shell-eval', /\b(?:eval|Invoke-Expression|iex)\b/i, 'HIGH'],
    ['node-process-execution', /\b(?:child_process|execSync|spawnSync|execFileSync|\bexec\s*\(|\bspawn\s*\()/i, 'MEDIUM'],
    ['broad-workflow-permission', /permissions\s*:\s*(?:write-all|\n(?:\s+[^\n]+:\s*write\s*\n){2,})/i, 'HIGH'],
    ['direct-contents-write', /contents\s*:\s*write/i, 'MEDIUM'],
    ['oidc-token-write', /id-token\s*:\s*write/i, 'MEDIUM'],
    ['unpinned-npx', /\bnpx\s+(?!--no-install\b)(?:-y\s+)?[a-z0-9@][^\s]*@(?:latest|next)\b/i, 'MEDIUM'],
    ['secret-like-literal', /\b(?:api[_-]?key|token|secret|password)\b\s*[:=]\s*["'](?!\$\{|\$|<|your-|example|changeme)[A-Za-z0-9_\-\.]{16,}["']/i, 'HIGH'],
    ['remote-mcp-transport', /\b(?:mcp|server)\b[\s\S]{0,400}\b(?:http|sse|streamable-http)\b/i, 'MEDIUM'],
    ['shell-or-filesystem-mcp', /\b(?:mcp|server)\b[\s\S]{0,400}\b(?:shell|filesystem|playwright|chrome-devtools|browser)\b/i, 'MEDIUM'],
  ];

  for (const [code, regex, severity] of rules) {
    const match = text.match(regex);
    if (match) findings.push(finding(rel, code, severity, clip(match[0], 320)));
  }

  if (lowerPath.includes('/hooks/') || lowerPath.startsWith('hooks/')) {
    findings.push(finding(rel, 'executable-hook-surface', 'HIGH', 'Hook surface requires separate trust review before enablement'));
  }
  if (path.basename(lowerPath) === '.mcp.json') {
    findings.push(finding(rel, 'mcp-configuration-surface', 'HIGH', 'MCP configuration is an authority/tool surface and is not enabled by intake'));
  }
  if (path.basename(lowerPath) === 'agents.md' || lowerPath.includes('/agents/')) {
    findings.push(finding(rel, 'agent-instruction-surface', 'MEDIUM', 'Agent/system-instruction-like content is untrusted external guidance until normalized'));
  }
}

function finding(file, code, severity, evidence) {
  return { file, code, severity, evidence_class: 'OBSERVED', evidence };
}

function dedupeFindings(findings) {
  const seen = new Set();
  return findings.filter((item) => {
    const key = `${item.file}|${item.code}|${item.evidence}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function walk(root, dir, out, maxFiles) {
  if (out.length >= maxFiles) return;
  let entries;
  try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
  for (const entry of entries) {
    if (out.length >= maxFiles) break;
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory() && SKIP_DIRS.has(entry.name)) continue;
    const abs = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(root, abs, out, maxFiles);
    else if (entry.isFile()) out.push(path.relative(root, abs).replaceAll('\\','/'));
  }
}

function clip(value, max) { return String(value ?? '').replace(/[\u0000\r\n]+/g, ' ').trim().slice(0, max); }

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const target = process.argv[2] || '.';
  const report = scanRepository(target);
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  if (report.summary.critical > 0) process.exitCode = 2;
}
