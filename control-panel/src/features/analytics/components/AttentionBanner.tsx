import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";
import { useFollow } from "../../../shared/navigation/useFollow";

// Something to DO goes above the numbers, not under them: the one thing on
// this page that asks for an action is the first thing read. It says how many
// and where to go; the list further down says why.
export function AttentionBanner({ count, href }: { count: number; href: string }) {
  const follow = useFollow();
  return (
    <MessageBar intent="warning">
      <MessageBarBody>
        <MessageBarTitle>
          {count} {count === 1 ? "skill needs" : "skills need"} attention
        </MessageBarTitle>
        A SKILL.md breaks the contract or goes past a documented limit. The reasons are listed below.
      </MessageBarBody>
      <MessageBarActions>
        <Button as="a" href={href} onClick={follow(href)}>
          Review in Skills
        </Button>
      </MessageBarActions>
    </MessageBar>
  );
}
