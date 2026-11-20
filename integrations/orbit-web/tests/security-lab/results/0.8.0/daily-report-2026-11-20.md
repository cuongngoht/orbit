# Governance audit report — 2026-11-20

Organization `org-a081ea1e9710` · generated 2026-11-20T10:17:24.663Z · 54 record(s) that day

## Audit integrity

The chain holds: 54 record(s), head `b979844adee6861d0955028afbb6726510cd952089b4835876aed96b4de920fb`.

## Agent activity

- `agt-f5bee7f5-ec6e`: 3 run(s) started, 0 refused, 3 ended; decisions: allow 7 · deny 9 · require_approval 1 [evt-f9b49b6c-c51f-4151-ba1c-1a18a8a72478, evt-80fd7777-e39e-43ca-bc06-8f633b153dc4, evt-27e80905-ff25-4306-b831-56e579589b85, evt-82264448-73c1-4249-930c-f95b724e5e54, evt-3252eecd-5bc3-4681-b45e-dd4c32519e85, evt-10d8169b-e0ac-4c0f-a37f-d330bffbc4d8, +30]

## Authorization

17 decision(s): allow 7 · deny 9 · require_approval 1
By action: agent.run.start 3 · credential.read_raw 1 · deployment.production 1 · network.egress 5 · repository.push 1 · tool.web 3 · workspace.execute 3

## Denied actions

- 2026-11-20T10:17:21.881Z · agent `agt-f5bee7f5-ec6e` · tool.web on `fe881939-1574-4b55-bd72-79752231292d` · held by: runtime · RULE_MATCHED [evt-3252eecd-5bc3-4681-b45e-dd4c32519e85]
- 2026-11-20T10:17:22.905Z · agent `agt-f5bee7f5-ec6e` · tool.web on `fe881939-1574-4b55-bd72-79752231292d` · held by: runtime · RULE_MATCHED [evt-760f17d6-1b34-4283-a55b-55e65348aab6]
- 2026-11-20T10:17:23.739Z · agent `agt-f5bee7f5-ec6e` · tool.web on `703383b6-aaaf-4f93-bc45-7971ebe64f2f` · held by: runtime · RULE_MATCHED [evt-6bbfb6a3-f972-4872-ac5b-97df23997eb9]
- 2026-11-20T10:17:23.825Z · agent `agt-f5bee7f5-ec6e` · credential.read_raw on `github` · held by: boundary · RULE_MATCHED [evt-41a2b171-899f-4dae-8eab-940a8786c4a3]
- 2026-11-20T10:17:23.827Z · agent `agt-f5bee7f5-ec6e` · deployment.production on `prod` · held by: none · RULE_MATCHED [evt-58c49063-505b-4f17-a8dd-4bd94141826d]
- 2026-11-20T10:17:23.833Z · agent `agt-f5bee7f5-ec6e` · network.egress on `example.com:443` · held by: boundary · DEFAULT_DECISION [evt-a75ffdca-4e37-4f3a-9b44-0e3a068b8288]
- 2026-11-20T10:17:23.835Z · agent `agt-f5bee7f5-ec6e` · network.egress on `orbit-web:3000` · held by: boundary · DEFAULT_DECISION [evt-38fc1e0a-6531-46eb-bc33-62903d966ba6]
- 2026-11-20T10:17:23.836Z · agent `agt-f5bee7f5-ec6e` · network.egress on `192.168.65.254:443` · held by: boundary · DEFAULT_DECISION [evt-fcd35aac-85f3-4383-ad4c-fd6ac9029f8e]
- 2026-11-20T10:17:23.837Z · agent `agt-f5bee7f5-ec6e` · network.egress on `169.254.169.254:80` · held by: boundary · DEFAULT_DECISION [evt-21bb6850-0ea1-470f-a55c-168611d9ed28]

## Protected approvals

- `apr-bee6d44e-a3bf-492f-8267-a48b3021cc48` · repository.push · `281c0b40fd017348` · last: approval.consume.refused [evt-4ca52cf7-c77f-4e02-b4a6-32616b8d2943, evt-4f23f5d6-d6d7-4abc-802e-a83c75177a73, evt-d84c7248-dc93-48a2-a395-b3a4812f85c5, evt-74441820-c52b-454d-992b-2f8300a26ab9, evt-41da88ce-b687-4525-ad65-ee38135b334b, evt-303af977-2f79-4728-a66c-2a7ad25b2134, +1]

## Security findings

- **AGENT_PRIVILEGE_ESCALATION** · CONFIRMED · critical — anonymous agent-network made 4 attempt(s) at an administrative or privileged operation; each was refused. [evt-d244186d-d0c8-4f12-8922-7b743bd10c8a, evt-bd7c85c1-e125-4a01-860f-bcc251308fc1, evt-37518a34-b1a3-4f33-9df4-a9a6c6f0feb0, evt-8cc66f21-6471-4450-9f0e-83fab8de7395]
- **AGENT_PRIVILEGE_ESCALATION** · CONFIRMED · critical — agent agt-f5bee7f5-ec6e made 1 attempt(s) at an administrative or privileged operation; each was refused. [evt-4f43e34a-9145-4d19-9d7d-fa0e9df733a6]
- **CREDENTIAL_ACCESS_ATTEMPT** · CONFIRMED · critical — agent agt-f5bee7f5-ec6e asked for a raw credential 1 time(s). [evt-41a2b171-899f-4dae-8eab-940a8786c4a3]
- **APPROVAL_REPLAY** · CONFIRMED · high — Approval apr-bee6d44e-a3bf-492f-8267-a48b3021cc48 was refused 2 time(s) (APPROVAL_CONSUMED). [evt-303af977-2f79-4728-a66c-2a7ad25b2134, evt-9fcfdfb9-0fca-4711-add8-965ab85c9653]
- **CROSS_WORKSPACE_ACCESS** · CONFIRMED · high — agent agt-f5bee7f5-ec6e used its run's authority on workspace fe881939-1574-4b55-bd72-79752231292d, which is not its own; refused 2 time(s). [evt-baa56d25-e5d4-49d1-ad94-e629a7e6bf3c, evt-7bc77204-7f3e-48e2-a1c5-bf4920e1cc8d]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent agt-f5bee7f5-ec6e asked for tool.web on fe881939-1574-4b55-bd72-79752231292d and was denied 2 time(s). [evt-3252eecd-5bc3-4681-b45e-dd4c32519e85, evt-760f17d6-1b34-4283-a55b-55e65348aab6]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent agt-f5bee7f5-ec6e asked for tool.web on 703383b6-aaaf-4f93-bc45-7971ebe64f2f and was denied 1 time(s). [evt-6bbfb6a3-f972-4872-ac5b-97df23997eb9]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent agt-f5bee7f5-ec6e asked for credential.read_raw on github and was denied 1 time(s). [evt-41a2b171-899f-4dae-8eab-940a8786c4a3]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent agt-f5bee7f5-ec6e asked for deployment.production on prod and was denied 1 time(s). [evt-58c49063-505b-4f17-a8dd-4bd94141826d]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent agt-f5bee7f5-ec6e asked for network.egress on example.com:443 and was denied 1 time(s). [evt-a75ffdca-4e37-4f3a-9b44-0e3a068b8288]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent agt-f5bee7f5-ec6e asked for network.egress on orbit-web:3000 and was denied 1 time(s). [evt-38fc1e0a-6531-46eb-bc33-62903d966ba6]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent agt-f5bee7f5-ec6e asked for network.egress on 192.168.65.254:443 and was denied 1 time(s). [evt-fcd35aac-85f3-4383-ad4c-fd6ac9029f8e]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent agt-f5bee7f5-ec6e asked for network.egress on 169.254.169.254:80 and was denied 1 time(s). [evt-21bb6850-0ea1-470f-a55c-168611d9ed28]

## Unresolved

- `AGENT_PRIVILEGE_ESCALATION:evt-d244186d-d0c8-4f12-8922-7b743bd10c8a`
- `AGENT_PRIVILEGE_ESCALATION:evt-4f43e34a-9145-4d19-9d7d-fa0e9df733a6`
- `CREDENTIAL_ACCESS_ATTEMPT:evt-41a2b171-899f-4dae-8eab-940a8786c4a3`
- `APPROVAL_REPLAY:evt-303af977-2f79-4728-a66c-2a7ad25b2134`
- `CROSS_WORKSPACE_ACCESS:evt-baa56d25-e5d4-49d1-ad94-e629a7e6bf3c`
- `POLICY_DENIED_ACTION:evt-3252eecd-5bc3-4681-b45e-dd4c32519e85`
- `POLICY_DENIED_ACTION:evt-6bbfb6a3-f972-4872-ac5b-97df23997eb9`
- `POLICY_DENIED_ACTION:evt-41a2b171-899f-4dae-8eab-940a8786c4a3`
- `POLICY_DENIED_ACTION:evt-58c49063-505b-4f17-a8dd-4bd94141826d`
- `POLICY_DENIED_ACTION:evt-a75ffdca-4e37-4f3a-9b44-0e3a068b8288`
- `POLICY_DENIED_ACTION:evt-38fc1e0a-6531-46eb-bc33-62903d966ba6`
- `POLICY_DENIED_ACTION:evt-fcd35aac-85f3-4383-ad4c-fd6ac9029f8e`
- `POLICY_DENIED_ACTION:evt-21bb6850-0ea1-470f-a55c-168611d9ed28`
