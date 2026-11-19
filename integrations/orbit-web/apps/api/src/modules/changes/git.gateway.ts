// THE GIT GATEWAY: every git command Orbit Web runs in a workspace. A workspace is untrusted -- its .git/config and
// .gitattributes are whatever the repository and the coding agent made them -- so each call switches off what could
// run a program on our behalf: hooks, the fsmonitor, external diff drivers and textconv filters, and reads no system or
// global configuration (gitEnv). Nothing here pushes.
import { Inject, Injectable } from "@nestjs/common";
import type { AppConfig } from "../../config/config.js";
import { APP_CONFIG, PROCESS_PORT } from "../../core/tokens.js";
import { gitEnv } from "../../infra/process/env.js";
import type { ProcessPort, RunResult } from "../../infra/process/process.port.js";

const HARDENING = ["-c", "core.fsmonitor=false", "-c", "core.hooksPath=/dev/null", "-c", "diff.external=", "-c", "core.quotePath=false"];

export const DIFF_LIMIT_BYTES = 1024 * 1024;

@Injectable()
export class GitGateway {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(PROCESS_PORT) private readonly process: ProcessPort,
  ) {}

  git(cwd: string, args: string[], maxOutputBytes = 8 * 1024 * 1024): Promise<RunResult> {
    return this.process.run(this.config.binaries.git, [...HARDENING, ...args], { cwd, env: gitEnv(this.config), timeoutMs: this.config.limits.commandTimeoutMs, maxOutputBytes });
  }

  head(cwd: string): Promise<RunResult> {
    return this.git(cwd, ["rev-parse", "--verify", "HEAD"]);
  }

  createBranch(cwd: string, branch: string): Promise<RunResult> {
    return this.git(cwd, ["checkout", "-b", branch]);
  }

  setConfig(cwd: string, key: string, value: string): Promise<RunResult> {
    return this.git(cwd, ["config", "--local", key, value]);
  }

  status(cwd: string): Promise<RunResult> {
    return this.git(cwd, ["status", "--porcelain=v2", "-z", "--branch", "--untracked-files=all"]);
  }

  numstat(cwd: string, base: string): Promise<RunResult> {
    return this.git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--numstat", "-z", base, "--"]);
  }

  nameStatus(cwd: string, base: string): Promise<RunResult> {
    return this.git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--name-status", "-z", base, "--"]);
  }

  fileDiff(cwd: string, base: string, path: string, oldPath: string | null): Promise<RunResult> {
    const paths = oldPath !== null && oldPath !== path ? [oldPath, path] : [path];
    return this.git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--find-renames", "--no-color", base, "--", ...paths], DIFF_LIMIT_BYTES);
  }

  // A file git does not track yet, as a diff against nothing (exit 1 means "they differ").
  untrackedDiff(cwd: string, path: string): Promise<RunResult> {
    return this.git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--no-color", "--no-index", "--", "/dev/null", path], DIFF_LIMIT_BYTES);
  }

  untrackedNumstat(cwd: string, path: string): Promise<RunResult> {
    return this.git(cwd, ["diff", "--no-ext-diff", "--no-textconv", "--numstat", "-z", "--no-index", "--", "/dev/null", path]);
  }
}
