import { useParams } from "react-router";
import { mutationToken } from "../../shared/api/client";
import { SkillEditor } from "./components/SkillEditor";

// `/skills/:id`. Keyed by the ID, so moving to another skill starts a fresh
// draft instead of carrying one skill's typing into the next.
export function SkillEditorPage() {
  const { id = "" } = useParams();
  return <SkillEditor key={id} id={id} readOnly={!mutationToken()} />;
}
