import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";
import { I18nProvider } from "../i18n";
import { AppEventsProvider } from "../services/events/AppEvents";

export const renderUi = (ui: ReactElement): RenderResult =>
  render(
    <I18nProvider locale="en">
      <FluentProvider theme={webLightTheme}>{ui}</FluentProvider>
    </I18nProvider>,
  );

// With the app stream open, for a component that follows its notifications.
export const renderLive = (ui: ReactElement): RenderResult =>
  render(
    <I18nProvider locale="en">
      <FluentProvider theme={webLightTheme}>
        <AppEventsProvider>{ui}</AppEventsProvider>
      </FluentProvider>
    </I18nProvider>,
  );
