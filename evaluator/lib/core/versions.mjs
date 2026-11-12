// What every arm of every campaign runs on, pinned in one place: the Claude Code version (checked with
// `npm view @anthropic-ai/claude-code version` on 2026-11-12: 2.1.322, the latest; the floor was 2.1.314), the Node
// image the tools volume is built from and packs run and are graded in, and where the tools are mounted.
export const CLAUDE_CODE_VERSION = "2.1.322";

export const NODE_IMAGE = "node:22";

export const TOOLS_MOUNT = "/opt/eval";

// The model API, the one host the egress proxy lets a run reach, and a host it must refuse (the check that it does).
export const API_HOST = "api.anthropic.com";

export const REFUSED_PROBE_HOST = "example.com";

// mini-SWE-agent, the second coding host (checked with PyPI on 2026-11-12: 2.4.6, the latest), in a uv virtualenv of
// this Python under $ORBIT_EVAL_HOME/tools/.
export const MINI_SWE_AGENT_VERSION = "2.4.6";

export const MINI_PYTHON = "3.11";
