/**
 * 流水线运行状态 —— `runs/<id>/state.json` + `runs/<id>/artifacts/<stepId>.json`。
 *
 * 每次状态变更同步写盘：进程中途退出时，state.json 仍能说明跑到了哪一步、哪一步失败、试了几次。
 * 每个成功步骤的产物单独落盘，可以拷出来单独重放下游步骤。
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export type StepStatus = "running" | "done" | "failed" | "skipped";

export interface StepState {
  status: StepStatus;
  attempts: number;
  startedAt?: string;
  endedAt?: string;
  error?: string;
  /** 产物文件（相对运行目录） */
  artifact?: string;
}

export interface PipelineState {
  pipeline: string;
  status: "running" | "done" | "failed";
  startedAt: string;
  endedAt?: string;
  steps: Record<string, StepState>;
  errors: Array<{ step: string; error: string }>;
}

export interface StateStore {
  readonly path: string;
  readonly state: PipelineState;
  start(stepId: string): void;
  attempt(stepId: string): number;
  done(stepId: string, artifact?: unknown): void;
  fail(stepId: string, error: string): void;
  skip(stepId: string): void;
  finish(status: "done" | "failed"): void;
}

/** 把步骤 ID 变成安全的文件名 */
export function artifactName(stepId: string): string {
  return `${stepId.replace(/[^\w.-]+/g, "_")}.json`;
}

export function createStateStore(runDir: string, pipelineName: string): StateStore {
  const path = join(runDir, "state.json");
  const artifactsDir = join(runDir, "artifacts");
  mkdirSync(artifactsDir, { recursive: true });

  const state: PipelineState = {
    pipeline: pipelineName,
    status: "running",
    startedAt: new Date().toISOString(),
    steps: {},
    errors: [],
  };
  const flush = () => writeFileSync(path, JSON.stringify(state, null, 2));
  const now = () => new Date().toISOString();
  const step = (id: string): StepState => (state.steps[id] ??= { status: "running", attempts: 0 });

  flush();

  return {
    path,
    state,
    start(id) {
      const s = step(id);
      s.status = "running";
      s.startedAt ??= now();
      delete s.error;
      flush();
    },
    attempt(id) {
      const s = step(id);
      s.attempts += 1;
      flush();
      return s.attempts;
    },
    done(id, artifact) {
      const s = step(id);
      s.status = "done";
      s.endedAt = now();
      delete s.error;
      if (artifact !== undefined) {
        const file = artifactName(id);
        writeFileSync(join(artifactsDir, file), JSON.stringify(artifact, null, 2) + "\n");
        s.artifact = `artifacts/${file}`;
      }
      flush();
    },
    fail(id, error) {
      const s = step(id);
      s.status = "failed";
      s.endedAt = now();
      s.error = error;
      state.errors.push({ step: id, error });
      flush();
    },
    skip(id) {
      const s = step(id);
      s.status = "skipped";
      s.endedAt = now();
      flush();
    },
    finish(status) {
      state.status = status;
      state.endedAt = now();
      flush();
    },
  };
}
