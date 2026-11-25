import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, test, vi } from "vitest";
import { fakeApi } from "../../testing/fakeApi";
import { renderUi } from "../../testing/render";
import { source, SOURCE_A, WORKSPACE_ID } from "../../testing/researchFixtures";
import { AddSourcesDialog } from "./AddSourcesDialog";

// An XMLHttpRequest that answers each upload 202 (the uploader sends the file's own bytes).
class FakeXhr {
  static sent: { url: string; headers: Record<string, string>; body: unknown }[] = [];
  status = 0;
  statusText = "";
  responseText = "";
  withCredentials = false;
  upload: { onprogress: ((e: { lengthComputable: boolean; loaded: number; total: number }) => void) | null } = { onprogress: null };
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  onabort: (() => void) | null = null;
  private url = "";
  private headers: Record<string, string> = {};
  open(_method: string, url: string) {
    this.url = url;
  }
  setRequestHeader(name: string, value: string) {
    this.headers[name] = value;
  }
  abort() {}
  send(body: unknown) {
    FakeXhr.sent.push({ url: this.url, headers: this.headers, body });
    queueMicrotask(() => {
      this.upload.onprogress?.({ lengthComputable: true, loaded: 1, total: 1 });
      this.status = 202;
      this.responseText = JSON.stringify(source({ id: "new-source", title: "notes", state: "queued", revision: null }));
      this.onload?.();
    });
  }
}

afterEach(() => {
  FakeXhr.sent = [];
  vi.unstubAllGlobals();
});

function show() {
  const onAdded = vi.fn();
  const onSelect = vi.fn();
  renderUi(<AddSourcesDialog workspaceId={WORKSPACE_ID} open onOpenChange={vi.fn()} sources={[source(), source({ id: "other", title: "Old notes" })]} selection={[SOURCE_A]} onSelect={onSelect} onAdded={onAdded} />);
  return { onAdded, onSelect };
}

describe("adding sources", () => {
  test("files are uploaded as their own bytes, with their name in a header; a kind research does not read is refused here", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    fakeApi();
    const { onAdded } = show();
    const input = screen.getByLabelText("Choose files to upload");
    await userEvent.upload(input, [new File(["# Notes"], "notes.md", { type: "text/markdown" }), new File(["MZ"], "setup.exe")], { applyAccept: false });
    await waitFor(() => expect(onAdded).toHaveBeenCalledWith(expect.objectContaining({ id: "new-source" })));
    expect(FakeXhr.sent.map((s) => [s.url, s.headers["content-type"], s.headers["x-orbit-filename"], s.headers["x-orbit-web"]])).toEqual([[`/api/research/workspaces/${WORKSPACE_ID}/sources/upload`, "application/octet-stream", "notes.md", "1"]]);
    expect(await screen.findByText(/Research does not read this kind of file/)).toBeInTheDocument();
    expect(screen.getByText("Not added")).toBeInTheDocument();
  });

  test("a website is fetched by the server; a pasted text is stored as Markdown or plain text", async () => {
    const a = fakeApi()
      .on("POST", `/api/research/workspaces/${WORKSPACE_ID}/sources/url`, () => source({ id: "u", kind: "url", title: "example.com", state: "queued", revision: null }))
      .on("POST", `/api/research/workspaces/${WORKSPACE_ID}/sources/text`, () => source({ id: "t", kind: "text", title: "Pasted", mediaType: "markdown" }));
    const { onAdded } = show();
    await userEvent.click(screen.getByRole("tab", { name: "Website" }));
    await userEvent.type(screen.getByRole("textbox", { name: /Website URL/ }), "https://example.com/article");
    await userEvent.click(screen.getByRole("button", { name: "Add website" }));
    await waitFor(() => expect(a.calls.find((c) => c.path.endsWith("/sources/url"))?.body).toEqual({ url: "https://example.com/article" }));
    expect(await screen.findByText(/keeps a snapshot of it/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Paste text" }));
    await userEvent.type(screen.getByRole("textbox", { name: /Title/ }), "Pasted");
    await userEvent.type(screen.getByRole("textbox", { name: /^Text/ }), "Body text.");
    await userEvent.click(screen.getByRole("button", { name: "Add text" }));
    await waitFor(() => expect(a.calls.find((c) => c.path.endsWith("/sources/text"))?.body).toEqual({ title: "Pasted", text: "Body text.", format: "markdown" }));
    expect(onAdded).toHaveBeenCalledTimes(2);
  });

  test("a source the workspace already has is used in this session without uploading it again", async () => {
    fakeApi();
    const { onSelect } = show();
    await userEvent.click(screen.getByRole("tab", { name: "From this workspace" }));
    await userEvent.click(screen.getByRole("checkbox", { name: "Old notes" }));
    await userEvent.click(screen.getByRole("button", { name: "Use in this session" }));
    expect(onSelect).toHaveBeenCalledWith([SOURCE_A, "other"]);
  });

  test("switching tabs preserves uploaded file status in Upload", async () => {
    vi.stubGlobal("XMLHttpRequest", FakeXhr);
    fakeApi();
    show();
    await userEvent.upload(screen.getByLabelText("Choose files to upload"), [new File(["# Notes"], "notes.md", { type: "text/markdown" })], { applyAccept: false });
    expect(await screen.findByText("notes.md")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("tab", { name: "Website" }));
    expect(screen.getByRole("textbox", { name: /Website URL/ })).toBeVisible();
    await userEvent.click(screen.getByRole("tab", { name: "Upload" }));
    expect(screen.getByText("notes.md")).toBeInTheDocument();
  });
});
