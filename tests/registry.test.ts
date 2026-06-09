import { describe, expect, it } from "vitest";

import { AgentRegistry } from "../src/agents/registry";
import { DEFAULT_CONFIG } from "../src/config/schema";
import { ProcessRunner } from "../src/process/process-runner";
import { Logger } from "../src/utils/logger";

class CountingProcessRunner extends ProcessRunner {
  public readonly commands: string[] = [];

  public async run(input: Parameters<ProcessRunner["run"]>[0]): ReturnType<ProcessRunner["run"]> {
    this.commands.push([input.command, ...input.args].join(" "));
    return {
      command: input.command,
      args: input.args,
      displayCommand: input.displayCommand,
      stdout: input.args.includes("--version") ? "1.0.0" : "Usage: fake [PROMPT]\nRead from stdin.",
      stderr: "",
      exitCode: 0,
      durationMs: 1,
      timedOut: false
    };
  }
}

describe("AgentRegistry detection filtering", () => {
  it("detects only selected agents when agent names are provided", async () => {
    const config = JSON.parse(JSON.stringify(DEFAULT_CONFIG));
    config.agents.codex.executablePath = process.execPath;
    config.agents.copilot.executablePath = process.execPath;
    config.agents.qwen.executablePath = process.execPath;
    const processRunner = new CountingProcessRunner();
    const registry = new AgentRegistry(config, {
      processRunner,
      logger: new Logger({ level: "error" })
    });

    const result = await registry.detect(["copilot"]);

    expect(Object.keys(result)).toEqual(["copilot"]);
    expect(result.copilot?.available).toBe(true);
    expect(result.codex).toBeUndefined();
    expect(result.qwen).toBeUndefined();
    expect(processRunner.commands).toHaveLength(2);
  });
});
