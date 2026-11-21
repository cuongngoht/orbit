// The page's width, as a test says it is: matchMedia answers the queries useViewport asks.
type Query = "(max-width: 639px)" | "(max-width: 1023px)" | "(max-width: 1279px)" | "(pointer: coarse)" | "(min-width: 1440px)";

export function mockViewport(queries: Partial<Record<Query, boolean>>): void {
  Object.defineProperty(window, "matchMedia", {
    writable: true,
    value: (query: string) => ({
      matches: Boolean((queries as Record<string, boolean>)[query]),
      media: query,
      onchange: null,
      addEventListener: () => {},
      removeEventListener: () => {},
      addListener: () => {},
      removeListener: () => {},
      dispatchEvent: () => false,
    }),
  });
}

export const mobileViewport = () => mockViewport({ "(max-width: 639px)": true, "(max-width: 1023px)": true, "(max-width: 1279px)": true, "(pointer: coarse)": true });
export const tabletViewport = () => mockViewport({ "(max-width: 1023px)": true, "(max-width: 1279px)": true });
export const wideViewport = () => mockViewport({ "(min-width: 1440px)": true });
