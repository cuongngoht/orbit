import {
  Button,
} from "../components/Button.jsx";

export function LoginPage({ onDone }) {
  const submit = async (form) => {
    const { createSession } = await import(
      "../api/sessionClient.js"
    );
    onDone(await createSession(form.user, form.password));
  };
  return <form onSubmit={submit}><Button label="Sign in" /></form>;
}
