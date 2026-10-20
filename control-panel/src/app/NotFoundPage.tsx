import { Button } from "@fluentui/react-components";
import { PageHeader } from "../shared/components/PageHeader";
import { useFollow } from "../shared/navigation/useFollow";
import { HOME } from "./navigation";

export function NotFoundPage() {
  const follow = useFollow();
  return (
    <PageHeader
      title="Page not found"
      description="Nothing lives at this address. It may have been a link to a skill that was deleted."
      actions={
        <Button as="a" href={HOME} onClick={follow(HOME)} appearance="primary">
          Go to Mission Control
        </Button>
      }
    />
  );
}
