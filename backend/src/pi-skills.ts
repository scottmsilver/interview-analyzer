import { existsSync, lstatSync, readdirSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { AgentTool, AgentToolResult } from '@earendil-works/pi-agent-core';
import { obj, str } from '@earendil-works/pi-schema';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const DEFAULT_SKILLS_DIR = resolve(__dirname, '..', 'skills');

export const SKILL_NAME_RE = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export interface SkillSummary {
  name: string;
  description: string;
  dirPath: string;
  skillFilePath: string;
}

export interface LoadedInterviewRubric {
  name: string;
  description: string;
  instructions: string;
}

function isSubpath(parentDir: string, candidatePath: string): boolean {
  const rel = relative(parentDir, candidatePath);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

export function assertNoSymlinksSync(rootReal: string, targetLexical: string): void {
  const rel = relative(rootReal, targetLexical);
  if (!rel || rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path "${targetLexical}" escapes skills root "${rootReal}"`);
  }
  const parts = rel.split(sep).filter(Boolean);
  let cur = rootReal;
  for (const part of parts) {
    cur = resolve(cur, part);
    let st;
    try {
      st = lstatSync(cur);
    } catch (err: unknown) {
      if ((err as NodeJS.ErrnoException)?.code === 'ENOENT') {
        break;
      }
      throw err;
    }
    if (st.isSymbolicLink()) {
      throw new Error(`Access denied: symbolic link "${cur}" is not permitted in skills directory`);
    }
  }
}

function stripYamlScalarQuotes(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2) {
    if (trimmed.startsWith('"') && trimmed.endsWith('"')) {
      return trimmed
        .slice(1, -1)
        .replace(/\\"/g, '"')
        .replace(/\\n/g, ' ')
        .replace(/\\\\/g, '\\')
        .trim();
    }
    if (trimmed.startsWith("'") && trimmed.endsWith("'")) {
      return trimmed.slice(1, -1).replace(/''/g, "'").trim();
    }
  }
  return trimmed;
}

export function parseSkillMarkdown(
  rawContent: string,
  fallbackName: string,
): { name: string; description: string; instructions: string } | null {
  const normalized = rawContent.replace(/\r\n/g, '\n');
  if (!normalized.startsWith('---\n')) {
    return null;
  }

  const endMatch = normalized.slice(4).match(/\n---(?:\n|$)/);
  if (!endMatch || endMatch.index === undefined) {
    return null;
  }

  const frontmatter = normalized.slice(4, 4 + endMatch.index);
  const bodyStart = 4 + endMatch.index + endMatch[0].length;
  const instructions = normalized.slice(bodyStart).trim();

  const fields: Record<string, string> = {};
  const lines = frontmatter.split('\n');
  let activeKey: string | null = null;
  let activeParts: string[] = [];

  const flushActive = () => {
    if (activeKey) {
      fields[activeKey] = activeParts.join(' ').replace(/\s+/g, ' ').trim();
      activeKey = null;
      activeParts = [];
    }
  };

  for (const line of lines) {
    if (!line.trim() || line.trim().startsWith('#')) {
      continue;
    }
    if (/^[ \t]+/.test(line) && activeKey) {
      activeParts.push(line.trim());
      continue;
    }
    flushActive();
    const m = line.match(/^([a-zA-Z0-9_-]+)\s*:\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase();
    const rest = m[2].trim();
    if (/^[>|][+-]?$/.test(rest)) {
      activeKey = key;
      activeParts = [];
    } else {
      activeKey = key;
      activeParts = [stripYamlScalarQuotes(rest)];
    }
  }
  flushActive();

  const name = (fields.name || fallbackName).trim();
  const description = (fields.description || '').replace(/\s+/g, ' ').trim();
  if (!SKILL_NAME_RE.test(name) || !description) {
    return null;
  }

  return { name, description, instructions };
}

export function discoverInterviewRubrics(skillsDir: string = DEFAULT_SKILLS_DIR): SkillSummary[] {
  const targetDir = resolve(skillsDir || DEFAULT_SKILLS_DIR);
  if (!existsSync(targetDir)) {
    return [];
  }

  let rootStat;
  try {
    rootStat = lstatSync(targetDir);
  } catch {
    return [];
  }
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
    return [];
  }

  let rootReal: string;
  try {
    rootReal = realpathSync(targetDir);
  } catch {
    return [];
  }

  let entries;
  try {
    entries = readdirSync(rootReal, { withFileTypes: true });
  } catch {
    return [];
  }

  const summaries: SkillSummary[] = [];
  const seenNames = new Set<string>();

  for (const entry of entries) {
    if (!SKILL_NAME_RE.test(entry.name)) {
      continue;
    }
    const skillDir = resolve(rootReal, entry.name);
    if (!isSubpath(rootReal, skillDir)) {
      continue;
    }
    let dirStat;
    try {
      dirStat = lstatSync(skillDir);
    } catch {
      continue;
    }
    if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
      continue;
    }

    const skillFile = resolve(skillDir, 'SKILL.md');
    let fileStat;
    try {
      fileStat = lstatSync(skillFile);
    } catch {
      continue;
    }
    if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
      continue;
    }

    let raw: string;
    try {
      raw = readFileSync(skillFile, 'utf8');
    } catch {
      continue;
    }

    const parsed = parseSkillMarkdown(raw, entry.name);
    if (!parsed || seenNames.has(parsed.name)) {
      continue;
    }
    seenNames.add(parsed.name);
    summaries.push({
      name: parsed.name,
      description: parsed.description,
      dirPath: skillDir,
      skillFilePath: skillFile,
    });
  }

  summaries.sort((a, b) => a.name.localeCompare(b.name));
  return summaries;
}

export function loadInterviewRubricByName(
  skillsDir: string,
  rawName: string,
): LoadedInterviewRubric {
  const trimmedName = (rawName || '').trim().toLowerCase();
  if (!SKILL_NAME_RE.test(trimmedName)) {
    throw new Error(
      `Invalid rubric name "${rawName}". Rubric names must match ^[a-z0-9][a-z0-9_-]{0,63}$.`,
    );
  }

  const targetDir = resolve(skillsDir || DEFAULT_SKILLS_DIR);
  if (!existsSync(targetDir)) {
    throw new Error(`Skills directory "${targetDir}" does not exist.`);
  }

  const rootStat = lstatSync(targetDir);
  if (rootStat.isSymbolicLink()) {
    throw new Error(`Access denied: skills directory "${targetDir}" cannot be a symbolic link.`);
  }
  if (!rootStat.isDirectory()) {
    throw new Error(`Skills path "${targetDir}" is not a directory.`);
  }

  const rootReal = realpathSync(targetDir);
  let skillDir = resolve(rootReal, trimmedName);
  let skillFile = resolve(skillDir, 'SKILL.md');

  if (!isSubpath(rootReal, skillDir) || !isSubpath(rootReal, skillFile)) {
    throw new Error(`Access denied: rubric "${trimmedName}" escapes skills directory.`);
  }

  assertNoSymlinksSync(rootReal, skillFile);

  if (!existsSync(skillFile)) {
    const all = discoverInterviewRubrics(rootReal);
    const byName = all.find((s) => s.name === trimmedName);
    if (!byName) {
      const available = all.map((s) => s.name);
      throw new Error(
        `Unknown interview rubric "${trimmedName}". Available rubrics: ${available.length > 0 ? available.join(', ') : '(none)'}.`,
      );
    }
    skillDir = byName.dirPath;
    skillFile = byName.skillFilePath;
    assertNoSymlinksSync(rootReal, skillFile);
  }

  const dirStat = lstatSync(skillDir);
  if (dirStat.isSymbolicLink() || !dirStat.isDirectory()) {
    throw new Error(`Access denied: rubric directory "${skillDir}" is invalid.`);
  }
  const fileStat = lstatSync(skillFile);
  if (fileStat.isSymbolicLink() || !fileStat.isFile()) {
    throw new Error(`Access denied: rubric file "${skillFile}" is invalid.`);
  }

  const raw = readFileSync(skillFile, 'utf8');
  const parsed = parseSkillMarkdown(raw, trimmedName);
  if (!parsed) {
    throw new Error(`Rubric "${trimmedName}" has invalid or missing YAML frontmatter in SKILL.md.`);
  }

  return {
    name: parsed.name,
    description: parsed.description,
    instructions: parsed.instructions,
  };
}

function redactList(text: string, secrets: (string | undefined)[]): string {
  let out = text;
  for (const s of secrets) {
    const trimmed = (s || '').trim();
    if (trimmed.length >= 8) {
      out = out.split(trimmed).join('[REDACTED]');
    }
  }
  return out;
}

const LoadInterviewRubricParamsSchema = obj({
  interviewType: str({
    description:
      "Interview rubric identifier (e.g. 'google-apm', 'meta-pm', 'amazon-pm', 'system-design', 'behavioral', 'generic').",
  }),
});

export function createLoadInterviewRubricTool(options: {
  skillsDir?: string;
  secretsToRedact?: (string | undefined)[];
  recordToolCall?: (name: string) => void;
} = {}): AgentTool<typeof LoadInterviewRubricParamsSchema> {
  const skillsDir = options.skillsDir || DEFAULT_SKILLS_DIR;
  const secrets = options.secretsToRedact ?? [];

  return {
    name: 'load_interview_rubric',
    label: 'Load interview evaluation rubric',
    description:
      'Load the role-specific evaluation rubric (dimensions, bar-raiser signals, metric hierarchy, red flags) for an interview type from the contained skills directory. Call this first when evaluating an interview.',
    parameters: LoadInterviewRubricParamsSchema,
    execute: async (_id, params): Promise<AgentToolResult<Record<string, never>>> => {
      try {
        const loaded = loadInterviewRubricByName(skillsDir, String(params?.interviewType ?? ''));
        options.recordToolCall?.('load_interview_rubric');
        const serialized = redactList(JSON.stringify(loaded), secrets);
        return {
          content: [{ type: 'text', text: serialized }],
          details: {},
          isError: false,
        };
      } catch (err) {
        const message = redactList(err instanceof Error ? err.message : String(err), secrets);
        return {
          content: [{ type: 'text', text: JSON.stringify({ error: message }) }],
          details: {},
          isError: true,
        };
      }
    },
  };
}
