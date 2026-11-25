# Governance audit report — 2026-11-21

Account `766d2418-3226-4960-bfc4-9f2b60ff83ec` · generated 2026-11-21T05:32:56.261Z · 44 record(s) that day

## Audit integrity

The chain holds: 44 record(s), head `dbc1d9acd6a0e07fde5f6f8fda346628002fa42918587de60fbac2e3b6a45f52`.

## Agent activity

- `claude-code`: 3 run(s) started, 0 refused, 3 ended; decisions: allow 7 · deny 10 · require_approval 1 [evt-e60c1c33-e0bc-47b6-9972-74a9be2f1a3f, evt-fe5b881e-c8c7-4af7-a344-c72a3da2fb6b, evt-409bf81d-efb8-4eeb-b4a3-9d4fe700a588, evt-c5ffc0f4-d68a-4833-a4f3-c0c4625aef51, evt-d1ecdcd1-1899-4d00-86e4-50f5a5ed83b1, evt-011b7477-006d-4400-af69-a0ac8ba6e394, +28]

## Authorization

18 decision(s): allow 7 · deny 10 · require_approval 1
By action: agent.run.start 3 · credential.read_raw 1 · deployment.production 1 · network.egress 6 · repository.push 1 · tool.web 3 · workspace.execute 3

## Denied actions

- 2026-11-21T05:32:52.335Z · agent `claude-code` · tool.web on `5d4445cc-23f5-460a-b4bf-e590ce205024` · held by: runtime · RULE_MATCHED [evt-fe5b881e-c8c7-4af7-a344-c72a3da2fb6b]
- 2026-11-21T05:32:53.797Z · agent `claude-code` · tool.web on `5d4445cc-23f5-460a-b4bf-e590ce205024` · held by: runtime · RULE_MATCHED [evt-88af2379-7255-44c7-95b0-f816d902598c]
- 2026-11-21T05:32:54.821Z · agent `claude-code` · tool.web on `46020d9c-4649-4ef0-8416-0abeb9ab24cd` · held by: runtime · RULE_MATCHED [evt-754b91b3-70c8-486b-92d6-3f9fe40a25ad]
- 2026-11-21T05:32:55.061Z · agent `claude-code` · credential.read_raw on `github` · held by: boundary · RULE_MATCHED [evt-eceee432-a519-4f21-8a60-820efba3d858]
- 2026-11-21T05:32:55.076Z · agent `claude-code` · deployment.production on `prod` · held by: none · RULE_MATCHED [evt-6d6ed058-723d-4ca2-ab05-5d0b24d6336b]
- 2026-11-21T05:32:55.097Z · agent `claude-code` · network.egress on `example.com:443` · held by: boundary · DEFAULT_DECISION [evt-04b37290-6c68-406e-a98e-c8f78d9020d1]
- 2026-11-21T05:32:55.105Z · agent `claude-code` · network.egress on `orbit-web:3000` · held by: boundary · DEFAULT_DECISION [evt-8f7a492b-8b8c-4272-a5dc-ee8356f18aa0]
- 2026-11-21T05:32:55.112Z · agent `claude-code` · network.egress on `postgres:5432` · held by: boundary · DEFAULT_DECISION [evt-4aee4d04-74ac-458f-b9d2-af2b76fbfac6]
- 2026-11-21T05:32:55.121Z · agent `claude-code` · network.egress on `192.168.65.254:443` · held by: boundary · DEFAULT_DECISION [evt-cf74bcbe-91fa-4d9d-be4e-e82dc0833b7b]
- 2026-11-21T05:32:55.140Z · agent `claude-code` · network.egress on `169.254.169.254:80` · held by: boundary · DEFAULT_DECISION [evt-b837e0b6-39ff-4963-bfba-cf70ade52895]

## Protected approvals

- `apr-eefc3ac2-a6bb-4421-a58b-ad0441fc4bf5` · repository.push · `6e2549f9470b0d70` · last: approval.consume.refused [evt-011b7477-006d-4400-af69-a0ac8ba6e394, evt-632d822a-9301-415d-ae5b-ed9229055ed5, evt-52ab28c8-7fe8-447e-a9d5-7133a03bb2bd, evt-66f4fd76-87dd-4347-8eaa-efed359af6ef, evt-57dc7a0f-0f5a-416b-ad97-670e4142a176, evt-c0a6e18d-fb61-4838-9fa8-702ce4be9f89, +1]

## Security findings

- **AGENT_PRIVILEGE_ESCALATION** · CONFIRMED · critical — agent claude-code made 1 attempt(s) at an administrative or privileged operation; each was refused. [evt-2edafe46-56a7-446a-8a41-782f172da83e]
- **CREDENTIAL_ACCESS_ATTEMPT** · CONFIRMED · critical — agent claude-code asked for a raw credential 1 time(s). [evt-eceee432-a519-4f21-8a60-820efba3d858]
- **APPROVAL_REPLAY** · CONFIRMED · high — Approval apr-eefc3ac2-a6bb-4421-a58b-ad0441fc4bf5 was refused 2 time(s) (APPROVAL_CONSUMED). [evt-c0a6e18d-fb61-4838-9fa8-702ce4be9f89, evt-ffb38cca-468a-4c68-a641-9eaaad3a47a5]
- **CROSS_WORKSPACE_ACCESS** · CONFIRMED · high — agent claude-code used its run's authority on workspace 5d4445cc-23f5-460a-b4bf-e590ce205024, which is not its own; refused 2 time(s). [evt-46a9489f-b378-499f-a4b3-4668483f4ee9, evt-c1e1637e-8315-45d8-86c7-832c1e141d8f]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent claude-code asked for tool.web on 5d4445cc-23f5-460a-b4bf-e590ce205024 and was denied 2 time(s). [evt-fe5b881e-c8c7-4af7-a344-c72a3da2fb6b, evt-88af2379-7255-44c7-95b0-f816d902598c]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent claude-code asked for tool.web on 46020d9c-4649-4ef0-8416-0abeb9ab24cd and was denied 1 time(s). [evt-754b91b3-70c8-486b-92d6-3f9fe40a25ad]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent claude-code asked for credential.read_raw on github and was denied 1 time(s). [evt-eceee432-a519-4f21-8a60-820efba3d858]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent claude-code asked for deployment.production on prod and was denied 1 time(s). [evt-6d6ed058-723d-4ca2-ab05-5d0b24d6336b]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent claude-code asked for network.egress on example.com:443 and was denied 1 time(s). [evt-04b37290-6c68-406e-a98e-c8f78d9020d1]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent claude-code asked for network.egress on orbit-web:3000 and was denied 1 time(s). [evt-8f7a492b-8b8c-4272-a5dc-ee8356f18aa0]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent claude-code asked for network.egress on postgres:5432 and was denied 1 time(s). [evt-4aee4d04-74ac-458f-b9d2-af2b76fbfac6]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent claude-code asked for network.egress on 192.168.65.254:443 and was denied 1 time(s). [evt-cf74bcbe-91fa-4d9d-be4e-e82dc0833b7b]
- **POLICY_DENIED_ACTION** · CONFIRMED · low — agent claude-code asked for network.egress on 169.254.169.254:80 and was denied 1 time(s). [evt-b837e0b6-39ff-4963-bfba-cf70ade52895]

## Unresolved

- `AGENT_PRIVILEGE_ESCALATION:evt-2edafe46-56a7-446a-8a41-782f172da83e`
- `CREDENTIAL_ACCESS_ATTEMPT:evt-eceee432-a519-4f21-8a60-820efba3d858`
- `APPROVAL_REPLAY:evt-c0a6e18d-fb61-4838-9fa8-702ce4be9f89`
- `CROSS_WORKSPACE_ACCESS:evt-46a9489f-b378-499f-a4b3-4668483f4ee9`
- `POLICY_DENIED_ACTION:evt-fe5b881e-c8c7-4af7-a344-c72a3da2fb6b`
- `POLICY_DENIED_ACTION:evt-754b91b3-70c8-486b-92d6-3f9fe40a25ad`
- `POLICY_DENIED_ACTION:evt-eceee432-a519-4f21-8a60-820efba3d858`
- `POLICY_DENIED_ACTION:evt-6d6ed058-723d-4ca2-ab05-5d0b24d6336b`
- `POLICY_DENIED_ACTION:evt-04b37290-6c68-406e-a98e-c8f78d9020d1`
- `POLICY_DENIED_ACTION:evt-8f7a492b-8b8c-4272-a5dc-ee8356f18aa0`
- `POLICY_DENIED_ACTION:evt-4aee4d04-74ac-458f-b9d2-af2b76fbfac6`
- `POLICY_DENIED_ACTION:evt-cf74bcbe-91fa-4d9d-be4e-e82dc0833b7b`
- `POLICY_DENIED_ACTION:evt-b837e0b6-39ff-4963-bfba-cf70ade52895`
