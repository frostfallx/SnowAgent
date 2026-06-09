import { AppConfig, AgentConfig } from "../config/schema";
import { Logger } from "../utils/logger";
import { ProcessRunner } from "../process/process-runner";
import { AgentName } from "../core/task";
import { AgentAdapter, AgentAdapterDeps } from "./base";
import { CodexAdapter } from "./codex";
import { CopilotAdapter } from "./copilot";
import { QwenAdapter } from "./qwen";

type AgentCtor = new (config: AgentConfig, deps: AgentAdapterDeps) => AgentAdapter;

const AGENT_FACTORIES: Record<AgentName, AgentCtor> = {
  codex: CodexAdapter,
  copilot: CopilotAdapter,
  qwen: QwenAdapter
};

export interface AgentRegistryDeps {
  processRunner: ProcessRunner;
  logger: Logger;
}

export class AgentRegistry {
  private readonly adapters = new Map<AgentName, AgentAdapter>();

  public constructor(
    private readonly config: AppConfig,
    private readonly deps: AgentRegistryDeps
  ) {}

  public get(name: AgentName): AgentAdapter | undefined {
    if (!this.config.agents[name].enabled) {
      return undefined;
    }

    const existing = this.adapters.get(name);
    if (existing) {
      return existing;
    }

    const AgentFactory = AGENT_FACTORIES[name];
    const adapter = new AgentFactory(this.config.agents[name], {
      appConfig: this.config,
      processRunner: this.deps.processRunner,
      logger: this.deps.logger.child({ agent: name })
    });
    this.adapters.set(name, adapter);
    return adapter;
  }

  public list(): Array<{
    name: AgentName;
    enabled: boolean;
    commandCandidates: string[];
    notes: string[];
  }> {
    return (Object.keys(AGENT_FACTORIES) as AgentName[]).map((name) => ({
      name,
      enabled: this.config.agents[name].enabled,
      commandCandidates: this.config.agents[name].commandCandidates,
      notes: this.config.agents[name].notes
    }));
  }

  public async detect(
    agentNames?: AgentName[]
  ): Promise<Partial<Record<AgentName, Awaited<ReturnType<AgentAdapter["detect"]>>>>> {
    const results: Partial<Record<AgentName, Awaited<ReturnType<AgentAdapter["detect"]>>>> = {};
    const selectedNames = agentNames ?? (Object.keys(AGENT_FACTORIES) as AgentName[]);

    for (const name of selectedNames) {
      const adapter = this.get(name);
      results[name] = adapter
        ? await adapter.detect()
        : {
            available: false,
            detectedInputModes: [],
            notes: ["Agent disabled in config."],
            error: "Agent disabled in config."
          };
    }

    return results;
  }

  public async detectAll(): Promise<Record<AgentName, Awaited<ReturnType<AgentAdapter["detect"]>>>> {
    return this.detect() as Promise<Record<AgentName, Awaited<ReturnType<AgentAdapter["detect"]>>>>;
  }
}

