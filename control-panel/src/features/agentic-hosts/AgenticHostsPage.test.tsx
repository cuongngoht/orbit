import { expect, it, vi } from 'vitest';
import { screen, within } from '@testing-library/react';
import { fakeServer } from '../../testing/fakeServer';
import { renderApp } from '../../testing/renderApp';
import type { AgenticHost } from './hosts.api';
it('shows desired memory separately from unavailable native capability and never guesses health', async () => {
  const server = fakeServer();
  const host: AgenticHost = { id: 'codex', name: 'Codex', protocols: ['2'], installed: 'unknown', configured: 'unknown', observed: true, lastObserved: '2026-09-27T00:00:00Z', version: null, engineVersion: '1.6.3', health: 'unknown', capabilities: { nativeMemory: false, promptRouter: true, sessionEnd: true }, desired: { host_memory: true }, effective: { host_memory: false }, revision: 1, diagnostic: null };
  vi.stubGlobal('fetch', (input: RequestInfo | URL, init?: RequestInit) => String(input).endsWith('/api/v1/agentic-hosts') ? Promise.resolve(new Response(JSON.stringify({ version: 1, hosts: [host] }), { headers: { 'Content-Type': 'application/json' } })) : server.fetch(String(input), init));
  renderApp('/agentic-hosts');
  const table = await screen.findByRole('table', { name: 'Codex settings' });
  expect(within(table).getByText('On')).toBeTruthy();
  expect(within(table).getByText('Off')).toBeTruthy();
  expect(screen.getByText('Hook observed')).toBeTruthy();
  expect(screen.getByText(/Installed: unknown/)).toBeTruthy();
  expect(screen.getByText(/Health: unknown/)).toBeTruthy();
});
