import fs from "node:fs";
import path from "node:path";

import type { AgentCapability, InputMode } from "../agents/base";

function isExecutableFile(candidatePath: string): boolean {
  try {
    const stats = fs.statSync(candidatePath);
    return stats.isFile();
  } catch {
    return false;
  }
}

function resolveFromPath(commandName: string, env: NodeJS.ProcessEnv): string | undefined {
  const pathEntries = (env.PATH ?? "").split(path.delimiter).filter(Boolean);
  const pathext =
    process.platform === "win32"
      ? (env.PATHEXT ?? ".EXE;.CMD;.BAT;.COM")
          .split(";")
          .filter(Boolean)
      : [""];
  const alreadyHasExtension = Boolean(path.extname(commandName));
  const extensions = alreadyHasExtension ? [""] : pathext;

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${commandName}${extension.toLowerCase()}`);
      if (isExecutableFile(candidate)) {
        return candidate;
      }
    }
  }

  return undefined;
}

export function resolveExecutable(
  configuredPath: string | undefined,
  commandCandidates: string[],
  env: NodeJS.ProcessEnv
): string | undefined {
  if (configuredPath) {
    const absolute = path.resolve(configuredPath);
    return isExecutableFile(absolute) ? absolute : undefined;
  }

  for (const candidate of commandCandidates) {
    if (candidate.includes(path.sep) || candidate.includes("/")) {
      const absolute = path.resolve(candidate);
      if (isExecutableFile(absolute)) {
        return absolute;
      }
    }

    const resolved = resolveFromPath(candidate, env);
    if (resolved) {
      return resolved;
    }
  }

  return undefined;
}

function addMode(
  modes: Set<InputMode>,
  mode: InputMode,
  capabilities: AgentCapability
): void {
  if (mode === "stdin" && capabilities.supportsStdin) {
    modes.add(mode);
  }
  if (mode === "file" && capabilities.supportsPromptFile) {
    modes.add(mode);
  }
  if (mode === "args" && capabilities.supportsArgs) {
    modes.add(mode);
  }
}

function orderInputModes(modes: Set<InputMode>, preferredOrder: InputMode[]): InputMode[] {
  const canonicalOrder: InputMode[] = ["stdin", "file", "args"];
  const ordered: InputMode[] = [];

  for (const mode of [...preferredOrder, ...canonicalOrder]) {
    if (modes.has(mode) && !ordered.includes(mode)) {
      ordered.push(mode);
    }
  }

  return ordered;
}

export function inferDetectedInputModes(
  helpText: string | undefined,
  declaredInputModes: InputMode[],
  capabilities: AgentCapability
): InputMode[] {
  const inferred = new Set<InputMode>();
  const normalizedHelp = (helpText ?? "").toLowerCase();

  if (normalizedHelp) {
    if (
      /\bstdin\b/u.test(normalizedHelp) ||
      normalizedHelp.includes("standard input") ||
      normalizedHelp.includes("read from stdin") ||
      normalizedHelp.includes("read from standard input") ||
      normalizedHelp.includes("instructions are read from stdin")
    ) {
      addMode(inferred, "stdin", capabilities);
    }

    if (
      normalizedHelp.includes("prompt-file") ||
      normalizedHelp.includes("prompt file") ||
      normalizedHelp.includes("prompt_file") ||
      normalizedHelp.includes("@file") ||
      /(?:^|[\s,])--(?:prompt-)?file\b/u.test(normalizedHelp) ||
      /(?:^|[\s,])-f,?\s+--file\b/u.test(normalizedHelp)
    ) {
      addMode(inferred, "file", capabilities);
    }

    if (
      normalizedHelp.includes("positionals:") ||
      normalizedHelp.includes("arguments:") ||
      /\[[a-z_-]*prompt[a-z_-]*\]/u.test(normalizedHelp) ||
      /(?:^|[\s,])-p,?\s+--prompt(?:\s|=|$)/u.test(normalizedHelp) ||
      /(?:^|[\s,])--prompt(?:\s|=|$)/u.test(normalizedHelp)
    ) {
      addMode(inferred, "args", capabilities);
    }
  }

  if (inferred.size > 0) {
    return orderInputModes(inferred, declaredInputModes);
  }

  return declaredInputModes;
}
