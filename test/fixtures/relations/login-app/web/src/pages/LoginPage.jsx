import { createSession } from "../api/sessionClient.js";
import { Button } from "../components/Button.jsx";

export function LoginPage({ onDone }) {
  const submit = async (form) => onDone(await createSession(form.user, form.password));
  return <form onSubmit={submit}><Button label="Sign in" /></form>;
}
