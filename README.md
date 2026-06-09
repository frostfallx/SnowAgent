# Agent Orchestrator

本项目是一个面向 Windows 11 的本地多 Agent CLI 编排器。它不依赖外部 REST API，而是通过本机命令行探测并调用不同的 AI CLI，把它们统一到同一套接口、路由和结果模型下。

第一阶段内置了三类适配器骨架：

- `codex`
- `copilot`
- `qwen`（也可通过配置指向 OpenCode/Qwen 风格 CLI）

项目重点不是“假装知道每个 CLI 的准确参数”，而是把这些不确定性做成可探测、可配置、可降级的系统。

当前仓库还带了一组“本机帮助文本校准过的保守默认值”：

- `codex` 默认走 `codex exec`
- `copilot` 默认走 `copilot --prompt`
- `qwen` 默认走位置参数 one-shot 模式

这些默认值是为了让项目在这台机器上更接近“开箱可跑”，不是为了宣称所有用户机器都一样，所以配置覆盖依然是第一优先级。

## 功能概览

- 统一的 `AgentAdapter` 接口：`detect()` / `buildCommand()` / `parseOutput()` / `run()`
- Windows 友好的进程执行器，优先使用 `spawn`，并处理 `.cmd/.bat/.ps1`
- CLI 探测：支持 PATH 查找和手动指定 executable path
- 输入模式优先级：`stdin` -> `file` -> `args`
- 统一结果模型：`stdout` / `stderr` / `exitCode` / `durationMs` / `timedOut` / `parsed`
- 规则路由与 fallback
- 结构化输出解析：支持 JSON / JSON 数组 / JSONL / `===RESULT_JSON===` / Markdown JSON code block，并会继续尝试从事件 envelope 中提取最终结构化内容
- YAML / JSON 配置与 `zod` 校验
- 本地 CLI 入口：`list` / `config` / `detect` / `doctor` / `status` / `sweep` / `route` / `prompt` / `history` / `inspect` / `artifacts` / `prune-artifacts` / `retention` / `apply-retention` / `export-task` / `preflight` / `validate` / `batch` / `retry` / `rerun` / `run`
- 基础单元测试，包含 `child_process.spawn` mock

## 目录结构

```text
src/
  agents/
  cli/
  config/
  core/
  parsers/
  process/
  utils/
tests/
demo/
agent-orchestrator.config.example.yaml
```

## 安装依赖

要求：

- Windows 11
- Node.js 18.18+，建议 Node.js 20+
- PowerShell 5.x 或 PowerShell 7.x

安装：

```powershell
npm install
```

## 构建

```powershell
npm run build
```

构建完成后，CLI 入口在：

- `dist/cli/index.js`

## 在 PowerShell 5 / 7 运行

PowerShell 5.x：

```powershell
node .\dist\cli\index.js list
node .\dist\cli\index.js config --agent codex
node .\dist\cli\index.js detect
node .\dist\cli\index.js doctor
node .\dist\cli\index.js status
node .\dist\cli\index.js sweep --apply-retention
node .\dist\cli\index.js route --task fix --cwd . --detect
node .\dist\cli\index.js prompt --task summarize --input-file .\demo\issue.txt --cwd .
node .\dist\cli\index.js preflight --task-file .\demo\summarize.task.yaml
node .\dist\cli\index.js history --limit 10
node .\dist\cli\index.js inspect --latest --kind run
node .\dist\cli\index.js artifacts --json
node .\dist\cli\index.js prune-artifacts --kind log --keep-latest 10
node .\dist\cli\index.js retention
node .\dist\cli\index.js apply-retention --kind log
node .\dist\cli\index.js export-task --latest-run --output-file .\exports\latest-run.task.yaml
node .\dist\cli\index.js validate --task-file .\demo\summarize.task.yaml
node .\dist\cli\index.js batch --plan-file .\demo\demo.batch.yaml --dry-run --preflight
node .\dist\cli\index.js retry --latest-failed --dry-run
node .\dist\cli\index.js rerun --latest-run --dry-run
node .\dist\cli\index.js run --task summarize --input-file .\demo\issue.txt --cwd . --preflight
```

PowerShell 7.x：

```powershell
node ./dist/cli/index.js list
node ./dist/cli/index.js config --json
node ./dist/cli/index.js detect
node ./dist/cli/index.js doctor --json
node ./dist/cli/index.js status --json
node ./dist/cli/index.js sweep --apply-retention --json
node ./dist/cli/index.js route --task review --cwd . --json
node ./dist/cli/index.js prompt --task summarize --input-file ./demo/issue.txt --cwd . --json
node ./dist/cli/index.js preflight --plan-file ./demo/demo.batch.yaml --json
node ./dist/cli/index.js history --kind preview --json
node ./dist/cli/index.js inspect --latest --kind batch --json
node ./dist/cli/index.js artifacts --kind run --json
node ./dist/cli/index.js prune-artifacts --kind preview --keep-latest 3 --json
node ./dist/cli/index.js retention --json
node ./dist/cli/index.js apply-retention --kind log --json
node ./dist/cli/index.js export-task --latest-failed --output-file ./exports/latest-failed.task.json --format json
node ./dist/cli/index.js validate --plan-file ./demo/demo.batch.yaml --json
node ./dist/cli/index.js batch --plan-file ./demo/demo.batch.yaml --dry-run --preflight --json
node ./dist/cli/index.js retry --latest-failed --dry-run --preflight --json
node ./dist/cli/index.js rerun --latest-run --dry-run --json
node ./dist/cli/index.js run --task review --input-file ./demo/review.diff.txt --cwd . --preflight
```

如果你把包全局链接或安装成 bin，也可以直接运行：

```powershell
agent-orchestrator detect
```

## 快速开始

1. 先复制示例配置。

```powershell
Copy-Item .\agent-orchestrator.config.example.yaml .\agent-orchestrator.config.yaml
```

2. 根据本机实际 CLI 修改：

- `agents.<name>.commandCandidates`
- `agents.<name>.executablePath`
- `agents.<name>.defaultArgs`
- `agents.<name>.run.stdinArgs`
- `agents.<name>.run.promptFileArgs`
- `agents.<name>.run.promptArgArgs`

3. 先做探测：

```powershell
node .\dist\cli\index.js detect --json
```

4. 先用 doctor 看最终执行预设，必要时顺手做 smoke：

```powershell
node .\dist\cli\index.js doctor --json
node .\dist\cli\index.js doctor --agent copilot --smoke --json
node .\dist\cli\index.js doctor --agent qwen --smoke --fail-on-unhealthy
node .\dist\cli\index.js status --json
node .\dist\cli\index.js sweep --apply-retention --json
node .\dist\cli\index.js config --agent copilot --json
node .\dist\cli\index.js route --task review --agent codex --cwd . --detect --json
node .\dist\cli\index.js prompt --task summarize --input-file .\demo\issue.txt --cwd . --json
node .\dist\cli\index.js preflight --task-file .\demo\review.task.yaml --json
node .\dist\cli\index.js history --kind preview --limit 5 --json
node .\dist\cli\index.js inspect --latest --kind run --json
node .\dist\cli\index.js artifacts --kind all --json
node .\dist\cli\index.js prune-artifacts --kind run --keep-latest 5 --json
node .\dist\cli\index.js retention --json
node .\dist\cli\index.js apply-retention --json
node .\dist\cli\index.js export-task --latest-run --output-file .\exports\rerun.task.yaml
node .\dist\cli\index.js validate --task-file .\demo\summarize.task.yaml --plan-file .\demo\demo.batch.yaml --json
node .\dist\cli\index.js batch --plan-file .\demo\demo.batch.yaml --dry-run --preflight --json
node .\dist\cli\index.js retry --report-file .\artifacts\batches\batch-demo.batch-123.json --dry-run --preflight --json
node .\dist\cli\index.js rerun --run-artifact .\artifacts\some-task\orchestration-result.json --dry-run --json
node .\dist\cli\index.js run --task-file .\demo\summarize.task.yaml --dry-run --preflight --json
```

5. 再跑 demo：

```powershell
node .\dist\cli\index.js run --task summarize --input-file .\demo\issue.txt --cwd . --agent auto
node .\dist\cli\index.js run --task review --input-file .\demo\review.diff.txt --cwd . --agent codex
node .\dist\cli\index.js run --task fix --input-file .\demo\bug.txt --cwd . --agent auto
```

如果你只想验证路由和命令构建，而不真的启动 agent，可以先用：

```powershell
node .\dist\cli\index.js run --task summarize --input-file .\demo\issue.txt --cwd . --dry-run --json
node .\dist\cli\index.js run --task-file .\demo\summarize.task.yaml --dry-run --json
```

## 配置说明

配置支持 JSON 和 YAML。默认会在当前目录查找：

- `agent-orchestrator.config.json`
- `agent-orchestrator.config.yaml`
- `agent-orchestrator.config.yml`

也可以显式指定：

```powershell
node .\dist\cli\index.js detect --config .\my-config.yaml
```

核心配置项：

```yaml
artifacts:
  rootDir: artifacts
  saveOutputs: true
  savePromptFiles: true
  saveLogs: true

retention:
  status:
    enabled: true
    olderThanDays: 14
    keepLatest: 30
  preview:
    enabled: true
    olderThanDays: 14
    keepLatest: 20
  run:
    enabled: false
    olderThanDays: 30
    keepLatest: 30
  log:
    enabled: true
    olderThanDays: 7
    keepLatest: 100

agents:
  codex:
    enabled: true
    commandCandidates: [codex, codex.exe, codex.cmd]
    executablePath:
    defaultArgs: [exec]
    inputModePriority: [stdin, args]
    timeoutMs: 120000
    retries: 1
    detect:
      versionArgs:
        - [--version]
      helpArgs:
        - [exec, --help]
    run:
      stdinArgs:
        - "-"
      promptFileArgs: []
      promptArgArgs:
        - "{prompt}"
      jsonModeArgs:
        - --json
      nonInteractiveArgs:
        - --skip-git-repo-check
        - --full-auto
      cwdArgs:
        - --cd
        - "{cwd}"
```

### 任务文件

除了直接传 `--task/--prompt/--input-file`，`route`、`prompt` 和 `run` 也支持通过 `--task-file` 读取完整任务定义。

支持 JSON 和 YAML，常见字段如下：

```yaml
type: summarize
title: Demo summarize task
promptFile: ./issue.txt
cwd: ..
preferredAgent: auto
fallbackAgents:
  - qwen
  - codex
timeoutMs: 60000
metadata:
  source: issue.txt
```

说明：

- `prompt` 和 `promptFile` 二选一
- `promptFile`、`cwd` 都按任务文件所在目录解析相对路径
- CLI 显式参数会覆盖任务文件中的同名字段
- 仓库已提供 `demo/*.task.yaml` 作为样例

如果你想顺序运行多个任务文件，可以使用批量计划文件，例如仓库自带的 [demo/demo.batch.yaml](</c:/Users/vmwin11/Desktop/SnowAgent/demo/demo.batch.yaml>)。

### 为什么不能硬编码 CLI 参数

因为不同机器上的 CLI 可能存在这些差异：

- 可执行文件名字不同
- 入口是 `.exe`、`.cmd`、`.bat` 或 `.ps1`
- 有的需要子命令，如 `chat` / `ask` / `run`
- 有的支持 `stdin`，有的只支持 `--prompt-file`
- 有的支持结构化输出，但输出的是 JSONL 事件流而不是单个 JSON 对象
- `--version`、`version`、`-h`、`--help` 的行为不一致
- 有的 CLI 输出 JSON，有的只输出普通文本

所以这里的策略是：

- 给出“保守默认值”
- 先探测 executable
- 把参数模板都暴露给配置
- 失败时不要崩，走 fallback

## CLI 命令

### `list`

列出注册的 adapter 和候选命令。

```powershell
node .\dist\cli\index.js list
node .\dist\cli\index.js list --json
```

### `detect`

探测当前配置下每个 agent 是否可用。使用 `--agent <name>` 可以只探测单个 agent，适合调试某个 CLI 的 PATH、help/version 参数或认证问题。

```powershell
node .\dist\cli\index.js detect
node .\dist\cli\index.js detect --agent codex
node .\dist\cli\index.js detect --json
```

调试探测逻辑时，优先查看：

- `commandCandidates`
- `executablePath`
- `detect.versionArgs`
- `detect.helpArgs`
- `detectedInputModes`：会先根据 help 文本中的 `stdin`、`--prompt`、`[PROMPT]`、`--prompt-file` 等线索推断真实可用输入方式；如果 help 没有足够信息，则回退到 adapter/config 声明的输入模式
- `artifacts/session-*.log`

如果探测失败，通常先在 PowerShell 里手工验证：

```powershell
codex --help
copilot --version
qwen -h
```

然后把能工作的命令形态回填到配置里。

在这台机器上，已经确认这些入口可探测：

- `codex --version`
- `codex exec --help`
- `copilot --help`
- `qwen --help`

因此示例配置默认优先使用这些已经验证存在的非交互入口。

### `config`

查看当前生效的合并后配置，以及到底加载到了哪份配置文件。

```powershell
node .\dist\cli\index.js config
node .\dist\cli\index.js config --agent codex --json
node .\dist\cli\index.js config --config .\my-config.yaml
```

这个命令适合：

- 确认当前到底有没有读到本地配置文件
- 查看每个 agent 的有效默认参数、输入模式和超时配置
- 查看每类 artifact 的默认 retention 策略
- 在修改 YAML/JSON 后快速核对 merge 结果

### `doctor`

输出每个 agent 的：

- 探测结果
- 当前 run 预设
- 可选 smoke-run 结果
- 总体健康状态与汇总计数
- 自动落盘的 doctor 报告路径
- 面向修复的建议动作，例如 auth / config / timeout / smoke

```powershell
node .\dist\cli\index.js doctor
node .\dist\cli\index.js doctor --json
node .\dist\cli\index.js doctor --agent copilot --smoke --json
node .\dist\cli\index.js doctor --agent qwen --smoke --fail-on-unhealthy
```

这个命令适合在真正跑任务前做一次“体检”：

- `detect` 只回答“命令在不在”
- `doctor` 会进一步告诉你“当前配置准备怎么调用它”
- 加 `--smoke` 后，还能直接验证 non-interactive 组合是不是当前机器真能跑
- 加 `--fail-on-unhealthy` 后，可以直接把 `doctor` 当成 CI / 脚本的健康检查入口
- 当 `doctor` 发现问题时，会在终端、JSON 和 `artifacts/doctor/*.json` 里同时给出下一步修复建议

### `status`

生成一份面向运维的一键快照，把 config 校验、doctor 健康、artifact 占用、retention 预览和最近失败记录合并到同一份报告里。

```powershell
node .\dist\cli\index.js status
node .\dist\cli\index.js status --json
node .\dist\cli\index.js status --agent codex --smoke --json
```

这个命令适合：

- 你离开电脑前，先快速确认系统当前是不是适合继续无人值守运行
- 不想分别跑 `doctor`、`artifacts`、`apply-retention` dry-run、`history` 时，直接看一份聚合结论
- 把最近失败的 `run` / `batch` 记录和下一步动作一起沉淀到 `artifacts/status/*.json`

说明：

- `status` 内部会静默复用 doctor、artifact 盘点和 retention 预览逻辑，但不会额外生成一堆 doctor / maintenance 子报告
- 生成的 `status` 报告可以直接通过 `history --kind status` 和 `inspect --latest --kind status` 回看

### `sweep`

运行一轮运维 sweep：先抓 baseline status，再按需执行 retention，最后再抓一份 final status，适合当成定时维护入口。

```powershell
node .\dist\cli\index.js sweep
node .\dist\cli\index.js sweep --apply-retention --json
node .\dist\cli\index.js sweep --apply-retention --fail-on-warning
node .\dist\cli\index.js sweep --agent codex --smoke --json
```

这个命令适合：

- 想把“看状态”和“做基础清理”合成一个无人值守步骤
- 在定时任务里先做 baseline/final 对比，再决定是否需要人工介入
- 结合 `--fail-on-warning` 或 `--fail-on-unhealthy`，把最终 sweep 结果直接变成脚本退出码

说明：

- 不加 `--apply-retention` 时，`sweep` 只会做 baseline/final 两次状态快照，不会真正删除任何 artifact
- 加上 `--apply-retention` 后，只有 baseline 里真的发现 retention 命中时才会执行清理
- `sweep` 会把聚合报告保存到 `artifacts/status/*.json`，并可继续通过 `history --kind status` / `inspect --latest --kind status` 回看

### `route`

预览某个任务会如何排 agent 顺序，而不真正执行任何 CLI。

```powershell
node .\dist\cli\index.js route --task review --cwd .
node .\dist\cli\index.js route --task fix --agent codex --fallback qwen copilot --cwd . --detect --json
node .\dist\cli\index.js route --task-file .\demo\review.task.yaml --detect --json
```

适合用来排查：

- 为什么当前任务优先走某个 agent
- fallback 顺序是不是符合预期
- 当前路由链路上的 agent 是否已经可探测

### `prompt`

预览最终下发给 agent 的 prompt，而不真正启动 agent。

```powershell
node .\dist\cli\index.js prompt --task summarize --input-file .\demo\issue.txt --cwd .
node .\dist\cli\index.js prompt --task review --input-file .\demo\review.diff.txt --cwd . --json
node .\dist\cli\index.js prompt --task-file .\demo\summarize.task.yaml --json
```

这个命令适合：

- 调试 PromptBuilder 模板
- 先确认结构化输出约束是否符合预期
- 在真正执行前检查 prompt 是否过长、是否包含了正确上下文

### `history`

查看 `artifacts/` 目录里的最近产物，包括 doctor/status 报告、route/prompt 预览、preflight、validation、maintenance 报告和实际运行结果。

```powershell
node .\dist\cli\index.js history
node .\dist\cli\index.js history --kind preview --limit 5 --json
node .\dist\cli\index.js history --kind status --limit 5 --json
node .\dist\cli\index.js history --kind preflight --limit 5 --json
node .\dist\cli\index.js history --kind validation --limit 5 --json
node .\dist\cli\index.js history --kind maintenance --limit 5 --json
node .\dist\cli\index.js history --kind batch --limit 5 --json
node .\dist\cli\index.js history --kind run --limit 10
node .\dist\cli\index.js history --kind run --status failed --agent codex --json
node .\dist\cli\index.js history --kind run --task-id demo --limit 3
```

这个命令适合：

- 快速回看最近一次 smoke / status / preview / preflight / validation / maintenance / batch / run 发生了什么
- 回看最近一次 artifact 盘点、按规则清理或 retention 执行做了什么
- 不手动翻目录，直接定位对应 artifact 路径
- 在脚本里提取最近的 doctor / status / preview / preflight / validation / maintenance / batch / run 记录
- 用 `--status` / `--task-id` / `--agent` 把列表快速缩到你关心的那一类记录

### `inspect`

直接查看某一个 artifact，或者按历史顺序选择最近一条记录做展开检查。

```powershell
node .\dist\cli\index.js inspect --artifact .\artifacts\some-task\orchestration-result.json
node .\dist\cli\index.js inspect --latest --kind status --json
node .\dist\cli\index.js inspect --latest --kind run --json
node .\dist\cli\index.js inspect --latest --kind batch --index 2
node .\dist\cli\index.js inspect --latest --kind maintenance --json
node .\dist\cli\index.js inspect --latest --kind run --status failed --agent codex
```

这个命令适合：

- 直接从最新 run / batch / preflight / doctor / status 结果里看详细上下文
- 直接展开最新一次 artifact 盘点、清理或 retention 报告
- 不自己打开 JSON 文件，也能快速知道 artifact 里有没有 task snapshot
- 配合 `history` 先看列表，再用 `inspect` 展开第 N 条
- 先用过滤条件锁定某个失败 run，再直接展开那一条 artifact

### `export-task`

从 `run` artifact 中提取 task snapshot，重新导出成一个可复用的 task-file。

```powershell
node .\dist\cli\index.js export-task --run-artifact .\artifacts\some-task\orchestration-result.json --output-file .\exports\task.yaml
node .\dist\cli\index.js export-task --latest-run --output-file .\exports\latest-run.task.yaml
node .\dist\cli\index.js export-task --latest-failed --output-file .\exports\latest-failed.task.json --format json --strip-id
```

这个命令适合：

- 把一次历史 `run` 重新沉淀成 task-file，纳入 `batch` 计划
- 在 `rerun` 之外，再保留一份可编辑、可版本化的任务快照
- 用 `--strip-id` 导出一个“下一次执行自动分配新 taskId”的模板

### `artifacts`

查看 `artifacts/` 当前占了多少空间、各类产物各有多少份，以及每一类最新的一条落在哪里。

```powershell
node .\dist\cli\index.js artifacts
node .\dist\cli\index.js artifacts --kind status --json
node .\dist\cli\index.js artifacts --kind run --json
node .\dist\cli\index.js artifacts --kind all --status success --agent qwen --json
```

这个命令适合：

- 长时间无人值守后，先看 `artifacts/` 是不是已经堆大了
- 判断主要空间是被 `run`、`preflight` 还是 session log 吃掉
- 在真正清理前，先按 `--status` / `--task-id` / `--agent` 缩小观察范围

每次 `artifacts` 盘点结果也会落到 `artifacts/maintenance/*.json`，因此可以直接配合：

```powershell
node .\dist\cli\index.js history --kind maintenance --limit 5 --json
node .\dist\cli\index.js inspect --latest --kind maintenance --json
```

### `prune-artifacts`

按保留条数或年龄阈值清理 artifact。默认是 dry-run，只有显式加 `--apply` 才会真的删除。

```powershell
node .\dist\cli\index.js prune-artifacts --kind log --keep-latest 10
node .\dist\cli\index.js prune-artifacts --kind preview --older-than-days 7 --json
node .\dist\cli\index.js prune-artifacts --kind run --status success --keep-latest 5 --apply
node .\dist\cli\index.js prune-artifacts --kind log --keep-latest 20 --fail-on-match
```

这个命令适合：

- 定期压缩 session log 数量，只保留最近几份
- 清理很久以前的 preview / preflight / validation 结果
- 对成功 run 做保留最近 N 份的策略，同时把失败 run 留久一点单独排查
- 用 `--fail-on-match` 把“发现可清理垃圾”直接转换成退出码，方便巡检脚本或 CI

说明：

- `prune-artifacts` 会按“逻辑单元”删除：`run` 会删整个 artifact 目录，`prompt preview` 会连同 `.json/.txt` 一起删
- `batch` 清理时会连同对应的 `retry-*.yaml` 一起处理
- `export` 和 `other` 只会出现在 `artifacts` 总览里，不会被 `prune-artifacts` 直接误删
- 每次 `prune-artifacts` 也会把计划或执行结果保存到 `artifacts/maintenance/*.json`，方便后续审计和回看

### `retention`

查看当前配置里的 retention 策略，不真正删除任何产物。

```powershell
node .\dist\cli\index.js retention
node .\dist\cli\index.js retention --kind log --json
```

这个命令适合：

- 快速确认默认或自定义配置到底会如何保留 `doctor` / `status` / `preview` / `preflight` / `run` / `batch` / `validation` / `maintenance` / `log`
- 在真正清理前，看某一类策略是否启用、保留条数和天数是不是符合预期
- 配合 `config` 一起排查为什么某些 artifact 一直被保留或一直被清掉

### `apply-retention`

按配置里的 retention 策略统一执行保留规则。默认也是 dry-run，只有显式加 `--apply` 才会真的删除。

```powershell
node .\dist\cli\index.js apply-retention
node .\dist\cli\index.js apply-retention --kind log --json
node .\dist\cli\index.js apply-retention --kind preview --apply
node .\dist\cli\index.js apply-retention --fail-on-match --json
```

这个命令适合：

- 把“保留策略”从临时命令参数提升成配置驱动的日常维护动作
- 在无人值守脚本里定期执行一次统一清理，而不是为每类 artifact 分别写 `prune-artifacts`
- 用 `--kind` 先单独演练某一类策略，再逐步扩大到全量 maintenance
- 用 `--fail-on-match` 把“当前有可清理垃圾”直接转换成退出码，方便巡检

说明：

- `apply-retention` 会把所有策略的执行结果聚合成一份 `mode=retention` 的 maintenance 报告，落到 `artifacts/maintenance/*.json`
- 内部每条策略虽然复用了 `prune-artifacts` 的逻辑，但不会额外散落一堆单独 prune 报告
- 这些 retention 报告同样可以通过 `history --kind maintenance` 和 `inspect --latest --kind maintenance` 回看

### `preflight`

把输入校验和路由可用性检查合成一份“执行前体检”报告，适合在真正 `run` / `batch` / `retry` 前先看一次。

```powershell
node .\dist\cli\index.js preflight --task-file .\demo\summarize.task.yaml
node .\dist\cli\index.js preflight --task review --input-file .\demo\review.diff.txt --cwd . --json
node .\dist\cli\index.js preflight --plan-file .\demo\demo.batch.yaml --fail-on-blocked
```

这个命令适合：

- 在无人值守执行前，先确认 task 或 batch 有没有被输入问题直接卡死
- 预先看到路由链上有哪些 agent 当前可用，哪些只能靠 fallback
- 把执行前状态保存到 `artifacts/preflight/*.json`，方便后续 `history` 回看

### `validate`

校验配置文件、task-file、batch plan 的格式和路径，而不真正运行 agent。

```powershell
node .\dist\cli\index.js validate
node .\dist\cli\index.js validate --task-file .\demo\summarize.task.yaml --json
node .\dist\cli\index.js validate --plan-file .\demo\demo.batch.yaml --fail-on-error
```

这个命令适合：

- 在无人值守批量执行前，先把 config/task/batch 文件检查一遍
- 发现 `promptFile`、task-file 路径、batch plan 引用是否缺失
- 在脚本里用退出码快速拦住坏输入
- 对 `--plan-file`，会继续把它引用到的每个 task-file 一并校验

每次校验结果也会落到 `artifacts/validation/*.json`，方便后续脚本或 `history --kind validation` 回看。

### `batch`

顺序执行一个批量计划文件，计划文件里引用多个 `task-file`。

```powershell
node .\dist\cli\index.js batch --plan-file .\demo\demo.batch.yaml --dry-run
node .\dist\cli\index.js batch --plan-file .\demo\demo.batch.yaml --dry-run --preflight --json
node .\dist\cli\index.js batch --plan-file .\demo\demo.batch.yaml --fail-on-error
```

批量计划文件示例：

```yaml
continueOnError: true
tasks:
  - path: ./summarize.task.yaml
    label: summarize-demo
  - path: ./review.task.yaml
    label: review-demo
```

这个命令适合：

- 你离开电脑时，顺序跑一组固定 task-file
- 先用 `--dry-run` 验证一整批任务的路由和命令构建
- 输出一份批量汇总报告，方便后续脚本读取

批量汇总报告默认会写到执行 `cwd` 对应的 `artifacts/batches/` 下，这样可以直接配合 `history --kind batch` 回看。
如果批量中有失败项，还会额外生成一个 `retry-*.yaml` 重跑计划，只保留失败任务，方便第二轮继续执行。
如果你加上 `--preflight`，批量在真正执行前会先生成一份 `preflight` 报告；当状态是 `blocked` 时会直接停止，避免无人值守时白跑一轮。
如果你希望更严格一点，还可以再加 `--fail-on-preflight-warning`，把降级到 fallback 的情况也当成失败。

### `retry`

直接执行失败重跑计划。它可以直接吃 `retry-*.yaml`，也可以从 batch 报告里自动解析 `retryPlanPath`，或者直接选择最近一次失败批次。

```powershell
node .\dist\cli\index.js retry --retry-plan .\artifacts\batches\retry-demo.batch-123.yaml --dry-run
node .\dist\cli\index.js retry --report-file .\artifacts\batches\batch-demo.batch-123.json --dry-run --preflight --json
node .\dist\cli\index.js retry --latest-failed --fail-on-error
```

这个命令适合：

- 批量任务失败后，直接从最新失败记录继续
- 不手工打开 batch JSON 查 `retryPlanPath`
- 把第二轮重跑也继续纳入同样的 batch artifact 流程

和 `batch` 一样，`retry` 也支持 `--preflight`；如果最新失败任务已经明显处于 `blocked` 状态，会在真正重跑前直接拦住。
同样也支持 `--fail-on-preflight-warning`，适合你只想在“完全 ready”时才继续第二轮重跑。

### `rerun`

从历史 `run` artifact 里重建原始任务并再次执行。它适合“上一轮跑过了，但我想按同一份任务再来一次”的场景。

```powershell
node .\dist\cli\index.js rerun --run-artifact .\artifacts\some-task\orchestration-result.json --dry-run
node .\dist\cli\index.js rerun --latest-run --dry-run --json
node .\dist\cli\index.js rerun --latest-failed --dry-run --preflight
```

这个命令适合：

- 直接复用最近一次 `run` 的任务输入，而不是手工重新拼参数
- 对同一份任务再做一次 dry-run / preflight / 实跑
- 从最近一次失败的 `run` 继续重试，而不是只支持 batch retry

说明：

- `rerun` 依赖较新的 `orchestration-result.json` 中包含 task snapshot；很早之前生成的旧 artifact 如果没有这部分内容，会提示你先重新跑一次新的 `run`
- 如果你不只是想“再跑一次”，而是想把这份历史任务另存为 task-file，可以改用 `export-task`

### `run`

执行标准任务。

```powershell
node .\dist\cli\index.js run --task summarize --input-file .\demo\issue.txt --cwd .
node .\dist\cli\index.js run --task review --prompt "review this diff" --agent codex --cwd .
node .\dist\cli\index.js run --task fix --input-file .\demo\bug.txt --agent auto --cwd . --dry-run --preflight
node .\dist\cli\index.js run --task-file .\demo\fix.task.yaml --dry-run --preflight --json
```

可用参数：

- `--task summarize|review|fix|plan`
- `--agent auto|codex|copilot|qwen`
- `--input-file <path>`
- `--prompt <text>`
- `--fallback <agents...>`
- `--cwd <path>`
- `--timeout-ms <ms>`
- `--json`
- `--dry-run`

如果你加上 `--preflight`，`run` 会先检查当前任务输入和路由 agent 状态；默认在 `blocked` 时直接停止，配合 `--fail-on-preflight-warning` 还可以把 `warning` 也当成失败。

带 `--json` 时，CLI 会抑制运行日志的标准输出污染，只保留最终 JSON 结果，方便后续脚本或 webhook 消费。

## 路由与 fallback

默认路由规则在配置中，而不是写死在代码里：

- `summarize -> copilot -> qwen -> codex`
- `review -> codex -> copilot -> qwen`
- `fix -> codex -> qwen -> copilot`
- `plan -> copilot -> qwen -> codex`

如果任务里显式指定 `preferredAgent` 或 CLI 传了 `--agent`，它会优先于默认路由。

如果首个 agent 不可用或执行失败，编排器会继续尝试后续 agent。

## 结构化输出约定

PromptBuilder 会要求 agent 输出：

```text
===RESULT_JSON===
{ ... }
===END_RESULT_JSON===
```

解析优先级：

1. 原始 JSON 对象或 JSON 数组
2. JSONL 事件流
3. `===RESULT_JSON===` 块
4. ```json code block
5. 启发式字段提取，如 `summary: ...`
6. 保留 raw text

这样即使外部 CLI 没能严格输出 JSON，系统也不会直接报废。

## 日志与产物

默认会在 `artifacts/` 下写出：

- `session-*.log`
- `doctor/*.json`
- `status/*.json`
- `preflight/*.json`
- `validation/*.json`
- `maintenance/*.json`
- `previews/*.json`
- `previews/*.txt`
- `batches/*.json`
- `<task-id>-<timestamp>/task-prompt.txt`
- `<task-id>-<timestamp>/<agent>-result.json`
- `<task-id>-<timestamp>/orchestration-result.json`

日志里会记录：

- 实际显示命令
- cwd
- timeout
- exitCode
- duration
- 解析结果

## 新增一个 Agent Adapter

新增适配器的步骤：

1. 新建一个类，例如 `src/agents/claude.ts`，继承 `ConfigurableCliAgentAdapter`
2. 在 `src/core/task.ts` 的 `AGENT_NAMES` 里加入新名称
3. 在 `src/config/schema.ts` 的默认配置里加入新 agent
4. 在 `src/agents/registry.ts` 的 `AGENT_FACTORIES` 注册新类
5. 根据新 CLI 的行为调整：
   - `commandCandidates`
   - `detect.versionArgs`
   - `detect.helpArgs`
   - `run.stdinArgs`
   - `run.promptFileArgs`
   - `run.promptArgArgs`

## 已实现的演示场景

1. summarize
   使用 `demo/issue.txt` 演示自动路由和结构化 summary。

2. review
   使用 `demo/review.diff.txt` 演示 review prompt 和结构化评论输出。

3. fix
   使用 `demo/bug.txt` 演示 fix plan / patch 结构化输出要求。

4. fallback
   Orchestrator 单元测试覆盖“第一个 agent 失败，自动降级到下一个 agent”。

## 测试

运行测试：

```powershell
npm test
```

测试覆盖：

- 结构化输出解析
- Router 排序逻辑
- Orchestrator fallback 行为
- `child_process.spawn` mock 下的 `ProcessRunner`

## 当前限制

- 可以从 help 文本中保守推断 `stdin`、prompt 参数、prompt file 等输入模式，但仍不能保证每个第三方 CLI 的真实 prompt 参数组合都正确
- 这版虽然对本机 `codex/copilot/qwen` 做了帮助文本校准，但仍不保证你的其他机器使用完全相同的参数组合
- 某些 CLI 若只能通过 shell alias 调用，而不是实际 `.exe/.cmd` 文件，当前 PATH 探测可能识别不到
- 对 `.cmd/.bat` 做了包装，但复杂 quoting 仍建议优先走 `stdin` 或 prompt file
- 结构化输出解析是 robust-first，不是 strict schema enforcement
- 当前 `qwen` adapter 采用“Qwen/OpenCode 风格”配置骨架，而不是某个特定发行版的硬编码实现
- 本机 `qwen` 已探测到 CLI，但实际 non-interactive 运行仍依赖你先完成 auth type 配置

## 开发建议

- 真正接机前，先执行 `detect`
- 若运行失败，先看本机 help 是否和示例配置一致，再决定是改 `defaultArgs` 还是改输入方式
- 尽量避免把超长 prompt 直接塞进命令行参数
- 如果某个 CLI 必须带子命令，放进 `defaultArgs`

## 许可证

按你的项目需要自行补充。
