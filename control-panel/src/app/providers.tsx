import { useMemo, useState, type ReactNode } from "react";
import { FluentProvider } from "@fluentui/react-components";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { isDark, storeChoice, storedChoice, themeFor, ThemeChoiceContext, useSystemPrefersDark, type ThemeChoice } from "./theme";

// A 4xx is the server's considered answer, and asking again gets the same one;
// only a network failure or a 5xx is worth one retry. A mutation is never
// retried: a save or a delete happens once, or the person decides again.
export function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: (count, error) => count < 1 && !isClientError(error), staleTime: 5_000 },
      mutations: { retry: false },
    },
  });
}

const isClientError = (error: unknown) => {
  const status = (error as { status?: number } | null)?.status ?? 0;
  return status >= 400 && status < 500;
};

export function Providers({ children, client }: { children: ReactNode; client?: QueryClient }) {
  const [queryClient] = useState(() => client ?? createQueryClient());
  const [choice, setStored] = useState<ThemeChoice>(storedChoice);
  const dark = isDark(choice, useSystemPrefersDark());
  const theme = useMemo(() => {
    const setChoice = (next: ThemeChoice) => {
      storeChoice(next);
      setStored(next);
    };
    return { choice, setChoice };
  }, [choice]);
  return (
    <QueryClientProvider client={queryClient}>
      <ThemeChoiceContext.Provider value={theme}>
        <FluentProvider theme={themeFor(dark)} className="app-root" data-theme={dark ? "dark" : "light"}>
          {children}
        </FluentProvider>
      </ThemeChoiceContext.Provider>
    </QueryClientProvider>
  );
}
