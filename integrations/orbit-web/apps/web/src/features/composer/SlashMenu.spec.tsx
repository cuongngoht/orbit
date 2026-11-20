import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { SlashCommands } from "@orbit-web/contracts";
import { describe, expect, test, vi } from "vitest";
import { fakeApi, withStatus, type Handler } from "../../testing/fakeApi";
import { renderUi } from "../../testing/render";
import { Composer } from "./Composer";

const PATH = "/api/sessions/s/commands";

const COMMANDS: SlashCommands = {
  commands: [
    { name: "sum-fixture:deploy", description: "Deploys the app", argumentHint: "<environment>", kind: "skill", origin: "project" },
    { name: "sum-fixture:review", description: "Review the diff", argumentHint: null, kind: "command", origin: "project" },
    { name: "orbit:orbit-help", description: "Orbit's coordinator and navigator", argumentHint: null, kind: "skill", origin: "orbit" },
    { name: "orbit:orbit-develop", description: "Implements a feature or a fix", argumentHint: "implement the change described", kind: "skill", origin: "orbit" },
  ],
  note: null,
};

function compose(handler: Handler = () => COMMANDS, commandsPath: string | null = PATH) {
  const api = fakeApi().on("GET", PATH, handler);
  const sent = vi.fn();
  renderUi(<Composer placeholder="Say something" canSend running={false} onSend={sent} commandsPath={commandsPath ?? undefined} />);
  return { api, sent, box: screen.getByRole("textbox", { name: "Message" }) };
}

const options = () => within(screen.getByRole("listbox", { name: "Skills and commands" })).getAllByRole("option");

describe("typing / at the start of a message lists the skills and commands the chat can run", () => {
  test("the project's first, then Orbit's, each with what it takes and what it does; read once, when the list first opens", async () => {
    const { api, box } = compose();
    expect(api.calls).toHaveLength(0);
    await userEvent.type(box, "/");
    const list = await screen.findByRole("listbox", { name: "Skills and commands" });
    expect(within(list).getByRole("group", { name: "This project" })).toBeInTheDocument();
    expect(within(list).getByRole("group", { name: "Orbit" })).toBeInTheDocument();
    expect(options().map((o) => o.querySelector("[data-name]")?.textContent)).toEqual(["/sum-fixture:deploy", "/sum-fixture:review", "/orbit:orbit-help", "/orbit:orbit-develop"]);
    expect(options()[0]).toHaveTextContent("<environment>");
    expect(options()[0]).toHaveTextContent("Deploys the app");
    expect(options()[0]).toHaveAttribute("aria-selected", "true");
    await userEvent.type(box, "o");
    expect(api.calls.filter((c) => c.path === PATH)).toHaveLength(1);
  });

  test("what follows the slash narrows the list; the arrows move, Enter takes one and leaves room for what it takes", async () => {
    const { box, sent } = compose();
    await userEvent.type(box, "/orbit");
    await screen.findByRole("listbox", { name: "Skills and commands" });
    expect(options().map((o) => o.querySelector("[data-name]")?.textContent)).toEqual(["/orbit:orbit-help", "/orbit:orbit-develop"]);
    await userEvent.keyboard("{ArrowDown}");
    expect(options()[1]).toHaveAttribute("aria-selected", "true");
    expect(box).toHaveAttribute("aria-activedescendant", options()[1]?.id);
    await userEvent.keyboard("{Enter}");
    expect(box).toHaveValue("/orbit:orbit-develop ");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(sent).not.toHaveBeenCalled();
    await userEvent.type(box, "add a button{Enter}");
    expect(sent).toHaveBeenCalledWith("/orbit:orbit-develop add a button");
  });

  test("a skill is found by its own name, without its plugin's; Tab and a click take one too", async () => {
    const { box } = compose();
    await userEvent.type(box, "/rev");
    await screen.findByRole("listbox", { name: "Skills and commands" });
    expect(options()[0]?.querySelector("[data-name]")?.textContent).toBe("/sum-fixture:review");
    await userEvent.keyboard("{Tab}");
    expect(box).toHaveValue("/sum-fixture:review ");
    await userEvent.clear(box);
    await userEvent.type(box, "/");
    await userEvent.click(await screen.findByRole("option", { name: /orbit:orbit-help/ }));
    expect(box).toHaveValue("/orbit:orbit-help ");
    expect(box).toHaveFocus();
  });

  test("what a skill does finds it by a word's start, never by a piece inside a word", async () => {
    const learn = { name: "orbit:orbit-learn", description: "Lessons that repeat across independent sessions", argumentHint: null, kind: "skill" as const, origin: "orbit" as const };
    const { box } = compose(() => ({ ...COMMANDS, commands: [...COMMANDS.commands, learn] }));
    await userEvent.type(box, "/dep");
    await screen.findByRole("listbox", { name: "Skills and commands" });
    expect(options().map((o) => o.querySelector("[data-name]")?.textContent)).toEqual(["/sum-fixture:deploy"]);
    await userEvent.clear(box);
    await userEvent.type(box, "/sess");
    await screen.findByRole("listbox", { name: "Skills and commands" });
    expect(options().map((o) => o.querySelector("[data-name]")?.textContent)).toEqual(["/orbit:orbit-learn"]);
  });

  test("Escape closes the list until the text changes", async () => {
    const { box } = compose();
    await userEvent.type(box, "/de");
    await screen.findByRole("listbox", { name: "Skills and commands" });
    await userEvent.keyboard("{Escape}");
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.type(box, "p");
    expect(await screen.findByRole("listbox", { name: "Skills and commands" })).toBeInTheDocument();
  });

  test("only at the very start, and only while the name is typed", async () => {
    const { box } = compose();
    await userEvent.type(box, "see /deploy");
    expect(screen.queryByRole("listbox")).toBeNull();
    await userEvent.clear(box);
    await userEvent.type(box, "/sum-fixture:deploy staging");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  test("nothing matches: said, and Enter sends the message as it is", async () => {
    const { box, sent } = compose();
    await userEvent.type(box, "/zzz");
    expect(await screen.findByText("No skill or command matches “/zzz”.")).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(sent).toHaveBeenCalledWith("/zzz");
  });

  test("the API's note about the project's skills, and a list that could not be read, are said under it", async () => {
    compose(() => ({ ...COMMANDS, note: "This repository's own skills are listed once a chat has opened it." }));
    await userEvent.type(screen.getByRole("textbox", { name: "Message" }), "/");
    expect(await screen.findByText("This repository's own skills are listed once a chat has opened it.")).toBeInTheDocument();
  });

  test("a list that could not be read is said, and the message can still be sent", async () => {
    const { box, sent } = compose(() => withStatus(500, { error: { code: "boom", message: "The skills could not be read." } }));
    await userEvent.type(box, "/x");
    expect(await screen.findByText(/The skills could not be read\./)).toBeInTheDocument();
    await userEvent.keyboard("{Enter}");
    expect(sent).toHaveBeenCalledWith("/x");
  });

  test("a composer with nothing to read offers no list", async () => {
    const { api, box } = compose(undefined, null);
    await userEvent.type(box, "/");
    expect(screen.queryByRole("listbox")).toBeNull();
    expect(api.calls).toHaveLength(0);
  });
});
