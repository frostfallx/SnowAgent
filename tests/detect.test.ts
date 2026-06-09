import { describe, expect, it } from "vitest";

import { AgentCapability } from "../src/agents/base";
import { inferDetectedInputModes } from "../src/utils/detect";

const allCapabilities: AgentCapability = {
  supportsStdin: true,
  supportsPromptFile: true,
  supportsArgs: true,
  supportsJsonMode: true,
  supportsCwd: true,
  supportsNonInteractive: true
};

describe("inferDetectedInputModes", () => {
  it("infers stdin and prompt argument support from help text", () => {
    const modes = inferDetectedInputModes(
      [
        "Usage: codex exec [OPTIONS] [PROMPT]",
        "If PROMPT is '-' instructions are read from stdin.",
        "Options:",
        "  -p, --prompt <text>  Execute this prompt"
      ].join("\n"),
      ["stdin", "args"],
      allCapabilities
    );

    expect(modes).toEqual(["stdin", "args"]);
  });

  it("infers prompt file support from common file flags", () => {
    const modes = inferDetectedInputModes(
      [
        "Usage: example run [options]",
        "  --prompt-file <path>  Read prompt file from disk",
        "  --json"
      ].join("\n"),
      ["stdin", "file", "args"],
      allCapabilities
    );

    expect(modes).toEqual(["file"]);
  });

  it("does not report modes disabled by adapter capabilities", () => {
    const modes = inferDetectedInputModes(
      "Usage: tool [PROMPT]\nPrompt can also be read from stdin with -.",
      ["stdin", "args"],
      {
        ...allCapabilities,
        supportsStdin: false
      }
    );

    expect(modes).toEqual(["args"]);
  });

  it("falls back to declared modes when help text is missing or uninformative", () => {
    const modes = inferDetectedInputModes(
      "General help without invocation details.",
      ["args"],
      allCapabilities
    );

    expect(modes).toEqual(["args"]);
  });
});
