import { FluentProvider, webLightTheme } from "@fluentui/react-components";
import { render, type RenderResult } from "@testing-library/react";
import type { ReactElement } from "react";

export const renderUi = (ui: ReactElement): RenderResult => render(<FluentProvider theme={webLightTheme}>{ui}</FluentProvider>);
