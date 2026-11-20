// IMAGES IN THE COMPOSER: a screenshot pasted (⌘V / Ctrl+V), images dropped on the box or picked with its button. Each
// is uploaded at once (its progress on its thumbnail) and held to Claude's limits before it leaves the page -- PNG,
// JPEG, GIF or WebP, at most IMAGE_LIMITS.perMessage of them, IMAGE_LIMITS.bytes each -- and can be taken out again. A
// message goes once every image is up; one that failed is said, and stays until it is taken out, so none is dropped
// unseen. Only where the page lets a message carry images: a chat -- never research, whose runs read only passages.
import { Button, Spinner, Tooltip, makeStyles, mergeClasses, shorthands, tokens } from "@fluentui/react-components";
import { Dismiss12Regular, ErrorCircle20Regular } from "@fluentui/react-icons";
import { IMAGE_LIMITS, isImageMediaType } from "@orbit-web/contracts";
import { useEffect, useRef, useState } from "react";
import { errorText } from "../../services/api";
import type { UploadImage } from "../../services/images";

export interface Attachment {
  key: string;
  preview: string;
  state: "uploading" | "ready" | "failed";
  progress: number;
  id: string | null;
  error: string | null;
}

const MB = Math.round(IMAGE_LIMITS.bytes / 1_048_576);

// A file that came from the clipboard has no name worth saying; one that was dropped or picked does.
const nameOf = (file: File): string => (file.name && file.name !== "image.png" ? `“${file.name}”` : "That image");

const previewOf = (file: File): string => (typeof URL.createObjectURL === "function" ? URL.createObjectURL(file) : "");

const release = (preview: string): void => {
  if (preview !== "" && typeof URL.revokeObjectURL === "function") URL.revokeObjectURL(preview);
};

// The files a paste, a drop or a pick holds.
export function filesOf(data: DataTransfer | null): File[] {
  if (data === null) return [];
  const fromItems = Array.from(data.items ?? [])
    .filter((i) => i.kind === "file")
    .map((i) => i.getAsFile())
    .filter((f): f is File => f !== null);
  return fromItems.length > 0 ? fromItems : Array.from(data.files ?? []);
}

let counter = 0;

export function useImageAttachments(upload: UploadImage | undefined) {
  const [items, setItems] = useState<Attachment[]>([]);
  const [notice, setNotice] = useState<string | null>(null);
  // Kept outside render, for the handlers and the clean-up: what is shown, how many are held, the uploads going on.
  const shown = useRef<Attachment[]>([]);
  const held = useRef(0);
  const uploads = useRef(new Map<string, AbortController>());

  useEffect(() => {
    shown.current = items;
  }, [items]);

  useEffect(() => {
    const going = uploads.current;
    return () => {
      for (const abort of going.values()) abort.abort();
      for (const a of shown.current) release(a.preview);
    };
  }, []);

  const patch = (key: string, change: Partial<Attachment>) => setItems((list) => list.map((a) => (a.key === key ? { ...a, ...change } : a)));

  const start = (file: File) => {
    counter += 1;
    const key = `image-${counter}`;
    held.current += 1;
    const abort = new AbortController();
    uploads.current.set(key, abort);
    setItems((list) => [...list, { key, preview: previewOf(file), state: "uploading", progress: 0, id: null, error: null }]);
    (upload as UploadImage)(file, (progress) => patch(key, { progress }), abort.signal)
      .then((image) => patch(key, { state: "ready", progress: 1, id: image.id }))
      .catch((err: unknown) => {
        if (!abort.signal.aborted) patch(key, { state: "failed", error: errorText(err) });
      })
      .finally(() => uploads.current.delete(key));
  };

  // Takes the images among `files` (true when there was one); says what it had to leave out, and why.
  const add = (files: File[]): boolean => {
    const images = files.filter((f) => f.type.startsWith("image/"));
    if (upload === undefined || images.length === 0) return false;
    const room = IMAGE_LIMITS.perMessage - held.current;
    const refused: string[] = [];
    const taken: File[] = [];
    for (const file of images) {
      if (!isImageMediaType(file.type)) refused.push(`${nameOf(file)} is not an image Claude reads (PNG, JPEG, GIF or WebP)`);
      else if (file.size > IMAGE_LIMITS.bytes) refused.push(`${nameOf(file)} is larger than ${MB} MB`);
      else if (taken.length >= room) refused.push(`a message carries at most ${IMAGE_LIMITS.perMessage} images`);
      else taken.push(file);
    }
    setNotice(refused.length > 0 ? `${[...new Set(refused)].join("; ")}.` : null);
    for (const file of taken) start(file);
    return true;
  };

  const remove = (key: string) => {
    uploads.current.get(key)?.abort();
    const gone = shown.current.find((a) => a.key === key);
    if (gone) release(gone.preview);
    held.current = Math.max(0, held.current - 1);
    setItems((list) => list.filter((a) => a.key !== key));
  };

  const clear = () => {
    for (const a of shown.current) release(a.preview);
    held.current = 0;
    setItems([]);
    setNotice(null);
  };

  return {
    enabled: upload !== undefined,
    items,
    notice,
    add,
    remove,
    clear,
    ids: items.filter((a) => a.state === "ready").map((a) => a.id as string),
    // Something not up yet, or failed: the message waits.
    holding: items.some((a) => a.state !== "ready"),
  };
}

const useStyles = makeStyles({
  strip: { display: "flex", flexWrap: "wrap", gap: "8px", listStyleType: "none", marginTop: 0, marginBottom: 0, paddingTop: "12px", paddingRight: "14px", paddingBottom: 0, paddingLeft: "14px" },
  thumb: {
    position: "relative",
    width: "64px",
    height: "64px",
    borderRadius: "12px",
    overflow: "hidden",
    backgroundColor: tokens.colorNeutralBackground3,
    ...shorthands.border("1px", "solid", tokens.colorNeutralStroke2),
    flexShrink: 0,
  },
  thumbFailed: { ...shorthands.borderColor(tokens.colorPaletteRedBorder2) },
  img: { width: "100%", height: "100%", objectFit: "cover", display: "block" },
  overlay: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, display: "flex", alignItems: "center", justifyContent: "center", backgroundColor: "rgba(0, 0, 0, 0.35)", color: tokens.colorNeutralForegroundOnBrand },
  failedIcon: { color: tokens.colorPaletteRedForeground1, backgroundColor: tokens.colorNeutralBackground1, borderRadius: "9999px" },
  progress: { position: "absolute", left: 0, bottom: 0, height: "3px", backgroundColor: tokens.colorBrandBackground, transitionProperty: "width", transitionDuration: "120ms" },
  remove: { position: "absolute", top: "3px", right: "3px", minWidth: "20px", width: "20px", height: "20px", padding: 0 },
  notice: { fontSize: tokens.fontSizeBase200, color: tokens.colorPaletteRedForeground1, paddingTop: "8px", paddingRight: "16px", paddingLeft: "16px" },
});

export function AttachmentStrip({ items, notice, onRemove }: { items: Attachment[]; notice: string | null; onRemove: (key: string) => void }) {
  const s = useStyles();
  if (items.length === 0 && notice === null) return null;
  return (
    <>
      {items.length > 0 && (
        <ul className={s.strip} aria-label="Images to send">
          {items.map((a, n) => (
            <li key={a.key} className={mergeClasses(s.thumb, a.state === "failed" && s.thumbFailed)}>
              {a.preview !== "" && <img src={a.preview} alt={`Image ${n + 1}`} className={s.img} />}
              {a.state === "uploading" && (
                <>
                  <span className={s.overlay}>
                    <Spinner size="extra-tiny" aria-label={`Uploading image ${n + 1}`} />
                  </span>
                  <span className={s.progress} style={{ width: `${Math.round(a.progress * 100)}%` }} />
                </>
              )}
              {a.state === "failed" && (
                <Tooltip content={a.error ?? "The upload failed."} relationship="description">
                  <span className={s.overlay} role="img" aria-label={`Image ${n + 1} was not uploaded: ${a.error ?? "it failed"}`}>
                    <ErrorCircle20Regular className={s.failedIcon} />
                  </span>
                </Tooltip>
              )}
              <Button className={s.remove} size="small" shape="circular" appearance="secondary" icon={<Dismiss12Regular />} aria-label={`Remove image ${n + 1}`} onClick={() => onRemove(a.key)} />
            </li>
          ))}
        </ul>
      )}
      {notice !== null && (
        <div className={s.notice} role="status">
          {notice}
        </div>
      )}
    </>
  );
}
