import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { AppEventsProvider } from "../services/events/AppEvents";

export const renderUi = (ui: ReactElement): RenderResult => render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);

// With the app stream open, for a component that follows its notifications.
export const renderLive = (ui: ReactElement): RenderResult =>
  render(
    <FluentProvider theme={webLightTheme}>
      <AppEventsProvider>{ui}</AppEventsProvider>
    </FluentProvider>,
  );
