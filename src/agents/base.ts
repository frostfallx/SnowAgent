import path from "node:path";

import { StructuredParseResult } from "../core/result";
import { AgentName, Task } from "../core/task";
import { parseStructuredOutput } from "../parsers/structured-output";
import {
  PreparedCommand,
  redactArgsForDisplay,
  formatCommandForDisplay,
  prepareWindowsCommand
} from "../process/windows-command";
import {
  ProcessRunResult,
  ProcessRunner
} from "../process/process-runner";
import { AppConfig, AgentConfig } from "../config/schema";
import { inferDetectedInputModes, resolveExecutable } from "../utils/detect";
import { Logger } from "../utils/logger";
import { createPromptTempFile } from "../utils/temp";

export type InputMode = "stdin" | "file" | "args";

export interface AgentCapability {
  supportsStdin: boolean;
  supportsPromptFile: boolean;
  supportsArgs: boolean;
  supportsJsonMode: boolean;
  supportsCwd: boolean;
  supportsNonInteractive: boolean;
}

export interface AgentDetectionResult {
  available: boolean;
  executable?: string;
  versionText?: string;
  helpText?: string;
  detectedInputModes: InputMode[];
  notes: string[];
  error?: string;
}

export interface AgentRunInput {
  task: Task;
  cwd: string;
  prompt: string;
  promptFilePath?: string;
  timeoutMs: number;
  env?: NodeJS.ProcessEnv;
  extraArgs?: string[];
  artifactDir?: string;
  dryRun?: boolean;
}

export interface AgentRunResult {
  agentName: AgentName;
  success: boolean;
  exitCode: number | null;
  stdout: string;
  stderr: string;
  durationMs: number;
  timedOut: boolean;
  parsed?: StructuredParseResult;
  rawOutput: string;
  logs: string[];
  attemptCount: number;
  executable?: string;
  commandLine?: string;
  inputMode?: InputMode;
  detection?: AgentDetectionResult;
  promptFilePath?: string;
  dryRun?: boolean;
}

export interface BuiltCommand {
  executable: string;
  args: string[];
  inputMode: InputMode;
  stdinData?: string;
  promptFilePath?: string;
  preparedCommand: PreparedCommand;
  commandLine: string;
}

export interface AgentAdapter {
  readonly name: AgentName;
  readonly capabilities: AgentCapability;
  detect(forceRefresh?: boolean): Promise<AgentDetectionResult>;
  buildCommand(input: AgentRunInput): Promise<BuiltCommand>;
  parseOutput(stdout: string, stderr: string): StructuredParseResult | undefined;
  run(input: AgentRunInput): Promise<AgentRunResult>;
}

export interface AgentAdapterDeps {
  appConfig: AppConfig;
  processRunner: ProcessRunner;
  logger: Logger;
}

function replacePlaceholders(template: string[], values: Record<string, string>): string[] {
  return template.map((entry) => {
    let updated = entry;
    for (const [key, value] of Object.entries(values)) {
      updated = updated.replaceAll(`{${key}}`, value);
    }
    return updated;
  });
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function extractNestedContentCandidate(data: unknown): string | undefined {
  if (typeof data === "string") {
    return data;
  }

  if (Array.isArray(data)) {
    for (let index = data.length - 1; index >= 0; index -= 1) {
      const candidate = extractNestedContentCandidate(data[index]);
      if (candidate) {
        return candidate;
      }
    }
    return undefined;
  }

  if (!isPlainObject(data)) {
    return undefined;
  }

  const directKeys = ["finalMessage", "content", "text", "message"];
  for (const key of directKeys) {
    if (typeof data[key] === "string" && data[key].trim().length > 0) {
      return data[key] as string;
    }
  }

  if (Array.isArray(data.messages)) {
    for (let index = data.messages.length - 1; index >= 0; index -= 1) {
      const message = data.messages[index];
      if (typeof message === "string" && message.trim().length > 0) {
        return message;
      }
    }
  }

  const nestedKeys = ["data", "item", "result"];
  for (const key of nestedKeys) {
    const candidate = extractNestedContentCandidate(data[key]);
    if (candidate) {
      return candidate;
    }
  }

  return undefined;
}

export abstract class ConfigurableCliAgentAdapter implements AgentAdapter {
  public readonly capabilities: AgentCapability;
  private cachedDetection?: AgentDetectionResult;

  protected constructor(
    public readonly name: AgentName,
    protected readonly agentConfig: AgentConfig,
    protected readonly deps: AgentAdapterDeps
  ) {
    this.capabilities = agentConfig.capabilities;
  }

  public async detect(forceRefresh = false): Promise<AgentDetectionResult> {
    if (!forceRefresh && this.cachedDetection) {
      return this.cachedDetection;
    }

    const notes: string[] = [];
    const configuredPath = this.agentConfig.executablePath;
    const executable = resolveExecutable(
      configuredPath,
      this.agentConfig.commandCandidates,
      process.env
    );

    if (!executable) {
      const unavailable: AgentDetectionResult = {
        available: false,
        detectedInputModes: this.getDeclaredInputModes(),
        notes,
        error:
          configuredPath !== undefined
            ? `Configured executable was not found: ${configuredPath}`
            : `No executable found in PATH for candidates: ${this.agentConfig.commandCandidates.join(", ")}`
      };
      this.cachedDetection = unavailable;
      return unavailable;
    }

    notes.push(
      configuredPath
        ? `Using configured executable path: ${configuredPath}`
        : `Resolved executable from PATH: ${executable}`
    );

    const versionText = await this.tryProbe("version", executable, notes);
    const helpText = await this.tryProbe("help", executable, notes);

    const detectedInputModes = inferDetectedInputModes(
      helpText,
      this.getDeclaredInputModes(),
      this.capabilities
    );
    if (detectedInputModes.join(",") !== this.getDeclaredInputModes().join(",")) {
      notes.push(
        `Inferred input modes from help text: ${detectedInputModes.join(", ") || "none"}`
      );
    }

    const detection: AgentDetectionResult = {
      available: true,
      executable,
      versionText,
      helpText,
      detectedInputModes,
      notes
    };

    this.cachedDetection = detection;
    return detection;
  }

  public async buildCommand(input: AgentRunInput): Promise<BuiltCommand> {
    const detection = await this.detect();
    if (!detection.available || !detection.executable) {
      throw new Error(detection.error ?? `${this.name} is unavailable.`);
    }

    const mode = await this.chooseInputMode(input);
    const args = [...this.agentConfig.defaultArgs];
    const placeholderValues: Record<string, string> = {
      cwd: input.cwd
    };

    if (this.capabilities.supportsJsonMode && this.agentConfig.run.jsonModeArgs.length > 0) {
      args.push(...this.agentConfig.run.jsonModeArgs);
    }

    if (this.capabilities.supportsNonInteractive) {
      args.push(...this.agentConfig.run.nonInteractiveArgs);
    }

    if (this.capabilities.supportsCwd && this.agentConfig.run.cwdArgs.length > 0) {
      args.push(...replacePlaceholders(this.agentConfig.run.cwdArgs, placeholderValues));
    }

    let stdinData: string | undefined;
    let promptFilePath = input.promptFilePath;

    if (mode === "stdin") {
      args.push(...this.agentConfig.run.stdinArgs);
      stdinData = input.prompt;
    }

    if (mode === "file") {
      promptFilePath =
        promptFilePath ??
        (await createPromptTempFile(
          input.prompt,
          this.name,
          input.artifactDir
        ));
      args.push(
        ...replacePlaceholders(this.agentConfig.run.promptFileArgs, {
          ...placeholderValues,
          promptFile: promptFilePath
        })
      );
    }

    if (mode === "args") {
      args.push(
        ...replacePlaceholders(this.agentConfig.run.promptArgArgs, {
          ...placeholderValues,
          prompt: input.prompt
        })
      );
    }

    if (input.extraArgs && input.extraArgs.length > 0) {
      args.push(...input.extraArgs);
    }

    const preparedCommand = prepareWindowsCommand(detection.executable, args);
    const displayArgs = redactArgsForDisplay(args, {
      redactValues: [input.prompt].filter(Boolean),
      maxArgLength: 160
    });
    return {
      executable: detection.executable,
      args,
      inputMode: mode,
      stdinData,
      promptFilePath,
      preparedCommand,
      commandLine: formatCommandForDisplay(detection.executable, displayArgs)
    };
  }

  public parseOutput(stdout: string, stderr: string): StructuredParseResult | undefined {
    const candidates = [
      stdout.trim(),
      stderr.trim(),
      [stdout, stderr].filter(Boolean).join("\n").trim()
    ].filter(Boolean);

    if (candidates.length === 0) {
      return undefined;
    }

    let fallback: StructuredParseResult | undefined;

    for (const candidate of candidates) {
      const parsed = this.promoteNestedStructuredParse(
        parseStructuredOutput(candidate),
        candidate
      );
      if (parsed.format !== "raw") {
        return parsed;
      }

      fallback ??= parsed;
    }

    return fallback;
  }

  private promoteNestedStructuredParse(
    parsed: StructuredParseResult,
    originalRawText: string
  ): StructuredParseResult {
    const nestedCandidate = extractNestedContentCandidate(parsed.data);
    if (!nestedCandidate) {
      return parsed;
    }

    const trimmedNested = nestedCandidate.trim();
    if (!trimmedNested || trimmedNested === originalRawText.trim()) {
      return parsed;
    }

    const nestedParsed = parseStructuredOutput(trimmedNested);
    if (nestedParsed.format === "raw") {
      return parsed;
    }

    return {
      format: nestedParsed.format,
      data: nestedParsed.data,
      rawText: originalRawText,
      extractionNotes: [
        ...parsed.extractionNotes,
        `Extracted nested structured payload from ${parsed.format} envelope.`,
        ...nestedParsed.extractionNotes
      ]
    };
  }

  public async run(input: AgentRunInput): Promise<AgentRunResult> {
    const logs: string[] = [];
    const record = (message: string): void => {
      const entry = `${new Date().toISOString()} ${message}`;
      logs.push(entry);
      this.deps.logger.info(message, { agent: this.name });
    };

    const detection = await this.detect();
    if (!detection.available) {
      record(`Agent unavailable: ${detection.error ?? "unknown reason"}`);
      return {
        agentName: this.name,
        success: false,
        exitCode: null,
        stdout: "",
        stderr: detection.error ?? "",
        durationMs: 0,
        timedOut: false,
        rawOutput: "",
        logs,
        attemptCount: 0,
        detection
      };
    }

    const attempts = Math.max(1, this.agentConfig.retries + 1);
    let lastRun: ProcessRunResult | undefined;
    let lastBuilt: BuiltCommand | undefined;

    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      const builtCommand = await this.buildCommand(input);
      lastBuilt = builtCommand;
      record(
        `Attempt ${attempt}/${attempts}: ${builtCommand.commandLine} (mode=${builtCommand.inputMode})`
      );

      if (input.dryRun) {
        record("Dry-run enabled, command execution skipped.");
        return {
          agentName: this.name,
          success: true,
          exitCode: 0,
          stdout: "",
          stderr: "",
          durationMs: 0,
          timedOut: false,
          rawOutput: "",
          logs,
          attemptCount: attempt,
          executable: builtCommand.executable,
          commandLine: builtCommand.commandLine,
          inputMode: builtCommand.inputMode,
          detection,
          promptFilePath: builtCommand.promptFilePath,
          dryRun: true
        };
      }

      const runResult = await this.deps.processRunner.run({
        command: builtCommand.preparedCommand.file,
        args: builtCommand.preparedCommand.args,
        displayCommand: builtCommand.commandLine,
        cwd: input.cwd,
        env: { ...process.env, ...this.agentConfig.env, ...input.env },
        stdinData: builtCommand.stdinData,
        timeoutMs: input.timeoutMs
      });
      lastRun = runResult;

      const success = runResult.exitCode === 0 && !runResult.timedOut;
      record(
        `Attempt ${attempt} finished with exitCode=${runResult.exitCode}, timedOut=${runResult.timedOut}, durationMs=${runResult.durationMs}`
      );

      if (success) {
        const parsed = this.parseOutput(runResult.stdout, runResult.stderr);
        return {
          agentName: this.name,
          success: true,
          exitCode: runResult.exitCode,
          stdout: runResult.stdout,
          stderr: runResult.stderr,
          durationMs: runResult.durationMs,
          timedOut: runResult.timedOut,
          parsed,
          rawOutput: [runResult.stdout, runResult.stderr].filter(Boolean).join("\n"),
          logs,
          attemptCount: attempt,
          executable: detection.executable,
          commandLine: builtCommand.commandLine,
          inputMode: builtCommand.inputMode,
          detection,
          promptFilePath: builtCommand.promptFilePath
        };
      }
    }

    const parsed = lastRun ? this.parseOutput(lastRun.stdout, lastRun.stderr) : undefined;
    return {
      agentName: this.name,
      success: false,
      exitCode: lastRun?.exitCode ?? null,
      stdout: lastRun?.stdout ?? "",
      stderr: lastRun?.stderr ?? "",
      durationMs: lastRun?.durationMs ?? 0,
      timedOut: lastRun?.timedOut ?? false,
      parsed,
      rawOutput: lastRun
        ? [lastRun.stdout, lastRun.stderr].filter(Boolean).join("\n")
        : "",
      logs,
      attemptCount: attempts,
      executable: detection.executable,
      commandLine: lastBuilt?.commandLine,
      inputMode: lastBuilt?.inputMode,
      detection,
      promptFilePath: lastBuilt?.promptFilePath
    };
  }

  protected getDeclaredInputModes(): InputMode[] {
    return this.agentConfig.inputModePriority.filter((mode) => {
      if (mode === "stdin") {
        return this.capabilities.supportsStdin;
      }
      if (mode === "file") {
        return this.capabilities.supportsPromptFile;
      }
      return this.capabilities.supportsArgs;
    });
  }

  private async chooseInputMode(input: AgentRunInput): Promise<InputMode> {
    const threshold = this.deps.appConfig.runtime.maxPromptArgLength;
    const promptFitsArgs = input.prompt.length <= threshold;

    for (const mode of this.agentConfig.inputModePriority) {
      if (mode === "stdin" && this.capabilities.supportsStdin) {
        return "stdin";
      }

      if (
        mode === "file" &&
        this.capabilities.supportsPromptFile &&
        this.agentConfig.run.promptFileArgs.length > 0
      ) {
        return "file";
      }

      if (
        mode === "args" &&
        this.capabilities.supportsArgs &&
        this.agentConfig.run.promptArgArgs.length > 0 &&
        promptFitsArgs
      ) {
        return "args";
      }
    }

    if (this.capabilities.supportsStdin) {
      return "stdin";
    }

    if (this.capabilities.supportsPromptFile && this.agentConfig.run.promptFileArgs.length > 0) {
      return "file";
    }

    if (this.capabilities.supportsArgs && this.agentConfig.run.promptArgArgs.length > 0) {
      return "args";
    }

    throw new Error(
      `No usable input mode configured for agent ${this.name}. Update agents.${this.name}.inputModePriority or run templates.`
    );
  }

  private async tryProbe(
    probeType: "version" | "help",
    executable: string,
    notes: string[]
  ): Promise<string | undefined> {
    const probes =
      probeType === "version"
        ? this.agentConfig.detect.versionArgs
        : this.agentConfig.detect.helpArgs;

    for (const args of probes) {
      const prepared = prepareWindowsCommand(executable, args);
      const result = await this.deps.processRunner.run({
        command: prepared.file,
        args: prepared.args,
        displayCommand: formatCommandForDisplay(executable, args),
        cwd: process.cwd(),
        timeoutMs: this.deps.appConfig.runtime.detectTimeoutMs
      });

      const output = [result.stdout, result.stderr].filter(Boolean).join("\n").trim();
      notes.push(
        `${probeType} probe ${formatCommandForDisplay(executable, args)} -> exitCode=${result.exitCode}`
      );

      if (output) {
        return output;
      }
    }

    notes.push(`No ${probeType} probe produced output.`);
    return undefined;
  }
}
