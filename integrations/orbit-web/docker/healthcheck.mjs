// The container's health check: the API's own /api/health answers 200 (it says 503, with the reason, when a program,
// the plugin or the storage is not usable).
const port = process.env.ORBIT_WEB_PORT ?? "3000";
try {
  const res = await fetch(`http://127.0.0.1:${port}/api/health`, { signal: AbortSignal.timeout(8_000) });
  process.exit(res.status === 200 ? 0 : 1);
} catch {
  process.exit(1);
}
