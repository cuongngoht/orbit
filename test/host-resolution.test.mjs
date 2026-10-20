import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolveHookHost } from '../skills/orbit-learn/hosts/index.mjs';
import { lifecycleEvent } from '../src/lifecycle/event.mjs';
import { commandOf } from '../src/engineering/working-set/collect.mjs';
const payload = { hook_event_name: 'PostToolUse', session_id: 'secret-session', cwd: '/repo', tool_name: 'Bash', tool_input: { command: 'node --test' } };
test('explicit identities never fall through overlapping payloads', async () => {
 assert.equal((await resolveHookHost(payload)).name, 'claude');
 assert.equal((await resolveHookHost(payload, ['--host=codex','--protocol=2'])).name, 'codex');
 for (const args of [['--host=other'],['--host=codex'],['--host=claude','--host=codex'],['--host=codex','--protocol=9'],['--protocol=2']]) assert.equal((await resolveHookHost(payload,args)).name,'unknown');
});
test('new unknown command never becomes successful and structured failure retains native name', async () => {
 const host=await resolveHookHost(payload,['--host=codex','--protocol=2']);
 const e=lifecycleEvent(host,payload);
 assert.equal(e.outcome,'unknown'); assert.equal(e.ok,null); assert.equal(commandOf(e).ok,null);
 const failed=lifecycleEvent(host,{...payload,tool_name:'mcp__fixture__read',tool_response:{isError:true}});
 assert.equal(failed.event,'post-tool-failure'); assert.equal(failed.hostEvent,'PostToolUse');
 assert.doesNotMatch(JSON.stringify(e),/secret-session/);
});
test('AGY v2 has bounded bootstrap and does not assign ambiguous workspaces', async () => {
 const host=await resolveHookHost(null,['--host=antigravity','--protocol=2']);
 const input={conversationId:'raw',workspacePaths:['/one','/two'],invocationNum:0};
 assert.equal(lifecycleEvent(host,input,['--event=PreInvocation']),null);
 assert.equal(lifecycleEvent(host,{...input,workspacePaths:['/one'],invocationNum:2},['--event=PreInvocation']),null);
 const e=lifecycleEvent(host,{...input,toolCall:{name:'write_to_file',args:{TargetFile:'/two/a.mjs'}},error:''},['--event=PostToolUse']);
 assert.equal(e.cwd,'/two');assert.equal(e.tool.kind,'edit');assert.equal(e.ok,true);
});
// AGY CLI 1.2.12, measured: tool payloads carry no executionNum, and stepIdx keeps
// counting across the executions of one conversation (3, then 8 on the next turn).
test('AGY v2 names a tool call by its conversation step, shared by Pre and Post, and names no turn', async () => {
 const host=await resolveHookHost(null,['--host=antigravity','--protocol=2']);
 const at=(event,stepIdx)=>lifecycleEvent(host,{conversationId:'raw',workspacePaths:['/one'],stepIdx,toolCall:{name:'run_command',args:{CommandLine:'node --test'}}},[`--event=${event}`]);
 assert.equal(at('PreToolUse',3).delivery,at('PostToolUse',3).delivery);
 assert.notEqual(at('PostToolUse',3).delivery,at('PostToolUse',8).delivery);
 assert.equal(at('PostToolUse',undefined).delivery,null);
 assert.equal(at('PostToolUse',3).turn,null);
});
// Grok Build (1.8.9) sends a Claude-shaped envelope (session_id, tool_name, hook_event_name in PascalCase), so shape
// alone would read it as Claude Code: only the identity its hooks file names selects it, and it has no legacy protocol.
test('Grok Build is selected by its explicit identity only, and a command it reports ending is known', async () => {
 const grok={hook_event_name:'PostToolUse',session_id:'raw-grok',cwd:'/repo',tool_name:'run_terminal_command',tool_input:{command:'node --test'},tool_response:{type:'Bash',exit_code:0,timed_out:false}};
 const host=await resolveHookHost(grok,['--host=grok','--protocol=2']);
 assert.equal(host.name,'grok');
 assert.equal((await resolveHookHost(grok,['--host=grok'])).name,'unknown','there is no legacy Grok transport');
 const e=lifecycleEvent(host,grok);
 assert.equal(e.ok,true); assert.equal(commandOf(e).ok,true);
 assert.equal(lifecycleEvent(host,{...grok,tool_response:{type:'Bash',exit_code:null,timed_out:true}}).ok,false,'a timeout is a failure');
 assert.equal(lifecycleEvent(host,{...grok,tool_response:{type:'Bash'}}).ok,null,'no exit code says nothing');
 assert.equal(lifecycleEvent(host,{...grok,isBackgrounded:true}).ok,null,'a backgrounded command has not ended');
 assert.doesNotMatch(JSON.stringify(e),/raw-grok/);
});
