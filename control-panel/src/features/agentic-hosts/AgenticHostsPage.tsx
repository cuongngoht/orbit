import { Badge, Text, makeStyles, tokens } from '@fluentui/react-components';
import { Card } from '../../shared/components/Card';
import { PageHeader } from '../../shared/components/PageHeader';
import { ErrorState } from '../../shared/components/ErrorState';
import { LoadingState } from '../../shared/components/LoadingState';
import { useAgenticHosts, type AgenticHost } from './hosts.api';
const useStyles = makeStyles({ stack: { display: 'flex', flexDirection: 'column', gap: tokens.spacingVerticalL }, table: { width: '100%', textAlign: 'left', borderCollapse: 'collapse', '& th, & td': { padding: tokens.spacingVerticalS } } });
export function AgenticHostsPage() {
  const query = useAgenticHosts();
  const styles = useStyles();
  return <><PageHeader title="Agentic Hosts" description="Three integrations share the Orbit engine and project memory. Observations and native capabilities are shown separately." />
    <div className={styles.stack}>
      {query.isPending && <LoadingState label="Loading host observations…" />}
      {query.isError && <ErrorState title="Could not read hosts" error={query.error} onRetry={() => query.refetch()} />}
      {query.data?.hosts.map((host) => <HostCard key={host.id} host={host} />)}
    </div></>;
}
function HostCard({ host }: { host: AgenticHost }) {
  const styles = useStyles();
  return <Card title={host.name}>
    <div className={styles.stack}>
      <Text>Installed: {host.installed} · Configured: {host.configured} · Native version: {host.version ?? 'unknown'}</Text>
      <Badge appearance="tint" color={host.observed ? 'informative' : 'subtle'}>{host.observed ? 'Hook observed' : 'No hook observation'}</Badge>
      <Text>{host.lastObserved ? `Last observed: ${host.lastObserved}` : 'No observation has been recorded.'} Health: {host.health}.</Text>
      <Text>Automatic prompt routing: {host.capabilities.promptRouter ? 'supported' : 'unavailable; use an explicit task'}. Session end: {host.capabilities.sessionEnd ? 'supported' : 'unavailable'}. Native memory hints: {host.capabilities.nativeMemory ? 'supported' : 'unavailable'}.</Text>
      <table className={styles.table} aria-label={`${host.name} settings`}><thead><tr><th>Setting</th><th>Desired</th><th>Effective</th></tr></thead><tbody>{Object.entries(host.desired).map(([key, desired]) => <tr key={key}><td>{key.replaceAll('_', ' ')}</td><td>{desired ? 'On' : 'Off'}</td><td>{host.effective[key] ? 'On' : 'Off'}</td></tr>)}</tbody></table>
      {host.diagnostic && <Text>Configuration status: {host.diagnostic}</Text>}
    </div>
  </Card>;
}
