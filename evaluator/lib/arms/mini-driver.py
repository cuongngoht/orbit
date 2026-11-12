#!/usr/bin/env python3
# THE MINI-SWE-AGENT DRIVER: what the `mini` and `mini+orbit` arms run, on the HOST, with the pinned mini-swe-agent's own
# interpreter. It builds mini-swe-agent's default agent from its default config (`mini.yaml`), drives it against the
# task container the evaluator already made (commands run there by `docker exec`, so that container needs no network:
# the model is called from here), and writes what happened to stdout in the shape of a coding host's stream-json --
# an init line, one assistant line per model call (its text and its shell commands as Bash tool calls), the command
# outputs, and one result line (cost, tokens, calls, how it stopped) -- so the controller reads a mini run exactly as it
# reads a Claude Code run. It decides nothing about the run: the controller and the grader do. The model's credential
# reaches it only as ANTHROPIC_API_KEY in this process's environment, set by the controller from the name it was handed;
# it is never written, printed or logged here.
#
#   python mini-driver.py <config.json>
#   config: { container, cwd, task, model, effort, steps, costUsd, commandTimeout, interpreter, systemExtra,
#             trajectory, deterministic: null | [{ content, command }], plugins: [{ name, version }], skills: [name] }
import json
import sys
import time

OUTPUT_CAP = 4000


def line(value):
    sys.stdout.write(json.dumps(value) + "\n")
    sys.stdout.flush()


def attached_environment():
    from minisweagent.environments.docker import DockerEnvironment, DockerEnvironmentConfig

    class AttachedConfig(DockerEnvironmentConfig):
        container: str

    class AttachedDocker(DockerEnvironment):
        """mini-swe-agent's Docker environment, attached to the container the evaluator made: it starts none and
        removes none (the evaluator does both, by its labels)."""

        def __init__(self, **kwargs):
            super().__init__(config_class=AttachedConfig, **kwargs)

        def _start_container(self):
            self.container_id = self.config.container

        def cleanup(self):
            return None

    return AttachedDocker


def text_of(content):
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        return "\n".join(p.get("text", "") for p in content if isinstance(p, dict) and isinstance(p.get("text"), str))
    return ""


def usage_of(message):
    response = message.get("extra", {}).get("response")
    usage = response.get("usage") if isinstance(response, dict) else None
    if not isinstance(usage, dict):
        return {}
    details = usage.get("prompt_tokens_details") or {}
    return {
        "input_tokens": usage.get("prompt_tokens") or 0,
        "output_tokens": usage.get("completion_tokens") or 0,
        "cache_read_input_tokens": usage.get("cache_read_input_tokens") or details.get("cached_tokens") or 0,
        "cache_creation_input_tokens": usage.get("cache_creation_input_tokens") or 0,
    }


def streaming_agent(base):
    class StreamingAgent(base):
        """mini-swe-agent's default agent, unchanged, with every message it adds also said on stdout."""

        def add_messages(self, *messages):
            for m in messages:
                said(self, m)
            return super().add_messages(*messages)

    return StreamingAgent


def said(agent, m):
    role = m.get("role")
    if role == "assistant":
        agent._n = getattr(agent, "_n", 0) + 1
        actions = m.get("extra", {}).get("actions", [])
        content = [{"type": "text", "text": text_of(m.get("content"))}] + [
            {"type": "tool_use", "id": f"t{agent._n}-{i}", "name": "Bash", "input": {"command": a.get("command", "")}}
            for i, a in enumerate(actions)
        ]
        line({"type": "assistant", "message": {"id": f"m{agent._n}", "role": "assistant", "content": content}})
        agent._usage = [*getattr(agent, "_usage", []), usage_of(m)]
        agent._last_text = text_of(m.get("content"))
    elif role in ("user", "tool") and getattr(agent, "_n", 0) > 0:
        line({"type": "user", "message": {"role": "user", "content": [{"type": "tool_result", "content": text_of(m.get("content"))[:OUTPUT_CAP]}]}})
    elif role == "exit":
        agent._exit = m.get("extra", {})


def model_of(c):
    if c.get("deterministic") is not None:
        from minisweagent.models.test_models import DeterministicModel, make_output

        outputs = [make_output(o["content"], [{"command": o["command"]}], cost=0.0) for o in c["deterministic"]]
        return DeterministicModel(outputs=outputs, cost_per_call=0.0)
    from minisweagent.models import get_model

    model = dict(c["base"].get("model", {}))
    model["model_kwargs"] = {**model.get("model_kwargs", {}), **({"reasoning_effort": c["effort"]} if c.get("effort") else {})}
    return get_model(input_model_name=f"anthropic/{c['model']}", config=model)


def agent_of(c, model):
    from minisweagent.agents.default import AgentConfig, DefaultAgent

    base = c["base"].get("agent", {})
    fields = {k: v for k, v in base.items() if k in AgentConfig.model_fields}
    system = fields["system_template"].rstrip("\n") + (("\n\n" + c["systemExtra"].strip() + "\n") if c.get("systemExtra") else "\n")
    env_base = c["base"].get("environment", {})
    env = attached_environment()(
        image="(attached)",
        container=c["container"],
        cwd=c["cwd"],
        env=env_base.get("env", {}),
        timeout=c["commandTimeout"],
        interpreter=c["interpreter"],
    )
    from pathlib import Path

    return streaming_agent(DefaultAgent)(
        model,
        env,
        **{**fields, "system_template": system, "step_limit": c["steps"], "cost_limit": c["costUsd"], "wall_time_limit_seconds": 0, "output_path": Path(c["trajectory"])},
    )


SUBTYPES = {"Submitted": "success", "TimeExceeded": "error_wall_time"}


def subtype_of(agent, status):
    if status == "LimitsExceeded":
        over_cost = 0 < agent.config.cost_limit <= agent.cost
        return "error_max_budget_usd" if over_cost else "error_max_turns"
    return SUBTYPES.get(status, "error_during_execution")


def api_error(e):
    module = type(e).__module__ or ""
    return module.split(".")[0] in ("litellm", "openai", "httpx", "anthropic")


def result_of(agent, started, error):
    exit_extra = getattr(agent, "_exit", {}) or {}
    status = exit_extra.get("exit_status") or (type(error).__name__ if error else "")
    usage = getattr(agent, "_usage", [])
    total = {k: sum(u.get(k, 0) for u in usage) for k in ("input_tokens", "output_tokens", "cache_read_input_tokens", "cache_creation_input_tokens")}
    text = "\n".join(t for t in [getattr(agent, "_last_text", "") or "", exit_extra.get("submission") or ""] if t)
    if error is not None:
        text = f"{'API Error' if api_error(error) else 'Agent error'}: {type(error).__name__}: {str(error)[:300]}"
    return {
        "type": "result",
        "subtype": subtype_of(agent, status),
        "is_error": error is not None or status not in ("Submitted",),
        "num_turns": agent.n_calls,
        "total_cost_usd": round(agent.cost, 6),
        "duration_ms": int((time.time() - started) * 1000),
        "usage": total,
        "permission_denials": [],
        "exit_status": status,
        "result": text,
    }


def main(path):
    c = json.loads(open(path, encoding="utf-8").read())
    import minisweagent
    from minisweagent.config import get_config_from_spec

    c["base"] = get_config_from_spec(c.get("config", "mini.yaml"))
    model = model_of(c)
    name = c.get("model") if c.get("deterministic") is None else "deterministic"
    line({"type": "system", "subtype": "init", "model": name, "host": "mini-swe-agent", "mini_swe_agent_version": minisweagent.__version__, "plugins": c.get("plugins", []), "skills": c.get("skills", []), "tools": ["bash"]})
    agent = agent_of(c, model)
    started = time.time()
    error = None
    try:
        agent.run(c["task"])
    except Exception as e:  # the agent records it as its exit message, then re-raises
        error = e
    line(result_of(agent, started, error))
    return 0


if __name__ == "__main__":
    sys.exit(main(sys.argv[1]))
