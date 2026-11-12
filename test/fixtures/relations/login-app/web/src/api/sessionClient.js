export async function createSession(user, password) {
  const response = await fetch("/api/session", { method: "POST", body: JSON.stringify({ user, password }) });
  return response.json();
}
