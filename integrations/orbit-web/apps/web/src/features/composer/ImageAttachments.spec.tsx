import { fireEvent, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IMAGE_LIMITS, type ImageRef } from "@orbit-web/contracts";
import { describe, expect, test, vi } from "vitest";
import { renderUi } from "../../testing/render";
import type { UploadImage } from "../../services/images";
import { Composer } from "./Composer";

const screenshot = (name = "image.png", type = "image/png", size = 1200) => new File([new Uint8Array(size)], name, { type });

// What a paste of a copied screenshot carries: a file, and no words.
const clipboardWith = (files: File[], text = "") => ({
  items: files.map((f) => ({ kind: "file", type: f.type, getAsFile: () => f })),
  files,
  types: files.length > 0 ? ["Files"] : ["text/plain"],
  getData: (format: string) => (format === "text/plain" ? text : ""),
});

const refOf = (n: number): ImageRef => ({ id: `0000000${n}-1111-4222-8333-444444444444`, mediaType: "image/png", width: 10, height: 10, bytes: 1200 });

// null: a page whose messages carry no images.
function compose(upload: UploadImage | null = vi.fn<UploadImage>(async () => refOf(1))) {
  const sent = vi.fn();
  renderUi(<Composer placeholder="Reply" canSend running={false} onSend={sent} onUploadImage={upload ?? undefined} />);
  return { sent, upload, box: screen.getByRole("textbox", { name: "Message" }) };
}

const sendButton = () => screen.getByRole("button", { name: "Send" });

describe("images in a chat message", () => {
  test("a pasted screenshot is shown, uploaded at once, and sent with the words -- or alone", async () => {
    const { sent, upload, box } = compose();
    fireEvent.paste(box, { clipboardData: clipboardWith([screenshot()]) });
    const strip = await screen.findByRole("list", { name: "Images to send" });
    expect(within(strip).getAllByRole("listitem")).toHaveLength(1);
    expect(upload).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await userEvent.click(sendButton());
    expect(sent).toHaveBeenCalledWith("", [refOf(1).id]);
    expect(screen.queryByRole("list", { name: "Images to send" })).toBeNull();
  });

  test("the message waits while an image is uploading, and one that failed is said and must be taken out", async () => {
    let finish: (ref: ImageRef) => void = () => undefined;
    const pending = vi.fn<UploadImage>(() => new Promise<ImageRef>((resolve) => (finish = resolve)));
    const { sent, box } = compose(pending);
    await userEvent.type(box, "what is wrong here?");
    fireEvent.paste(box, { clipboardData: clipboardWith([screenshot()]) });
    expect(await screen.findByLabelText("Uploading image 1")).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    finish(refOf(2));
    await waitFor(() => expect(sendButton()).toBeEnabled());
    await userEvent.click(sendButton());
    expect(sent).toHaveBeenCalledWith("what is wrong here?", [refOf(2).id]);
  });

  test("an upload that fails holds the message until it is removed", async () => {
    const failing = vi.fn<UploadImage>(async () => {
      throw new Error("That is not an image Claude reads: PNG, JPEG, GIF or WebP.");
    });
    const { box } = compose(failing);
    await userEvent.type(box, "look");
    fireEvent.paste(box, { clipboardData: clipboardWith([screenshot()]) });
    expect(await screen.findByLabelText(/Image 1 was not uploaded: That is not an image Claude reads/)).toBeInTheDocument();
    expect(sendButton()).toBeDisabled();
    await userEvent.click(screen.getByRole("button", { name: "Remove image 1" }));
    expect(sendButton()).toBeEnabled();
  });

  test("what Claude does not read, and more than a message carries, is said -- and left out", async () => {
    const { upload, box } = compose(vi.fn<UploadImage>(async () => refOf(3)));
    fireEvent.paste(box, { clipboardData: clipboardWith([screenshot("photo.heic", "image/heic")]) });
    expect(await screen.findByRole("status")).toHaveTextContent("“photo.heic” is not an image Claude reads (PNG, JPEG, GIF or WebP).");
    fireEvent.paste(box, { clipboardData: clipboardWith([screenshot("huge.png", "image/png", IMAGE_LIMITS.bytes + 1)]) });
    expect(await screen.findByRole("status")).toHaveTextContent(`“huge.png” is larger than ${Math.round(IMAGE_LIMITS.bytes / 1_048_576)} MB.`);
    fireEvent.paste(box, { clipboardData: clipboardWith(Array.from({ length: IMAGE_LIMITS.perMessage + 1 }, () => screenshot())) });
    expect(await screen.findByRole("status")).toHaveTextContent(`a message carries at most ${IMAGE_LIMITS.perMessage} images`);
    expect(upload).toHaveBeenCalledTimes(IMAGE_LIMITS.perMessage);
  });

  test("images dropped on the box, or picked with its button, go too; words pasted stay words", async () => {
    const { upload, box } = compose();
    fireEvent.drop(box.closest("form") as HTMLFormElement, { dataTransfer: clipboardWith([screenshot("a.png")]) });
    await userEvent.upload(screen.getByTestId("image-picker"), screenshot("b.jpg", "image/jpeg"));
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("button", { name: "Add images -- or paste a screenshot" })).toBeInTheDocument();
    fireEvent.paste(box, { clipboardData: clipboardWith([], "plain words") });
    expect(upload).toHaveBeenCalledTimes(2);
  });

  test("where a message carries no images (research), a pasted image is not taken and there is no button for one", async () => {
    const { box } = compose(null);
    fireEvent.paste(box, { clipboardData: clipboardWith([screenshot()]) });
    expect(screen.queryByRole("list", { name: "Images to send" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Add images -- or paste a screenshot" })).toBeNull();
  });
});
