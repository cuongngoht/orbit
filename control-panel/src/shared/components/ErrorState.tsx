import { Button, MessageBar, MessageBarActions, MessageBarBody, MessageBarTitle } from "@fluentui/react-components";

interface ErrorStateProps {
  error: unknown;
  title?: string;
  onRetry?: () => void;
}

// Shows what the server said, including every validation problem it listed,
// so a refused save explains itself rather than just failing.
export function ErrorState({ error, title = "Something went wrong", onRetry }: ErrorStateProps) {
  const details = detailsOf(error);
  return (
    <MessageBar intent="error" layout="multiline">
      <MessageBarBody>
        <MessageBarTitle>{title}</MessageBarTitle>
        {messageOf(error)}
        {details.length > 0 && (
          <ul aria-label="Problems">
            {details.map((d) => (
              <li key={d}>{d}</li>
            ))}
          </ul>
        )}
      </MessageBarBody>
      {onRetry && (
        <MessageBarActions>
          <Button onClick={onRetry}>Retry</Button>
        </MessageBarActions>
      )}
    </MessageBar>
  );
}

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

// An ApiError's `details`, or any other error that carries a list of problems.
function detailsOf(error: unknown): string[] {
  const details = (error as { details?: unknown } | null)?.details;
  return Array.isArray(details) ? details.map(String) : [];
}
