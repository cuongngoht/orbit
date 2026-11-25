// IMAGES in a chat message -- a screenshot pasted, a picture dropped or picked -- sent to Claude with the words. An image
// is uploaded first, as its own bytes (the one upload convention: application/octet-stream), and the server names it,
// reads what it is from its bytes (PNG, JPEG, GIF or WebP -- never SVG) and keeps it for the Claude account that
// uploaded it. A message then names its images by id, and each image goes with exactly one message.
export const IMAGE_MEDIA_TYPES = ["image/png", "image/jpeg", "image/gif", "image/webp"] as const;
export type ImageMediaType = (typeof IMAGE_MEDIA_TYPES)[number];

// Claude's own limits, held before anything is sent: the images one message carries, the bytes of one image, and the
// pixels of a side.
export const IMAGE_LIMITS = { perMessage: 6, bytes: 5 * 1024 * 1024, side: 8000 } as const;

export interface ImageRef {
  id: string;
  mediaType: ImageMediaType;
  // Read from the image's own header; null when it does not say.
  width: number | null;
  height: number | null;
  bytes: number;
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

export const isImageId = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

export const isImageMediaType = (v: unknown): v is ImageMediaType => typeof v === "string" && (IMAGE_MEDIA_TYPES as readonly string[]).includes(v);

// What is wrong with a message's images as sent -- absent, or distinct ids, at most `perMessage` -- or null.
export function imageIdsProblem(v: unknown): string | null {
  if (v === undefined) return null;
  if (!Array.isArray(v) || !v.every(isImageId)) return "images must be a list of image ids";
  if (new Set(v).size !== v.length) return "images must not name an image twice";
  if (v.length > IMAGE_LIMITS.perMessage) return `a message carries at most ${IMAGE_LIMITS.perMessage} images`;
  return null;
}

// Where the images of a chat's messages are read (behind the chat's own access rule).
export const chatImagePath = (sessionId: string, imageId: string): string => `/api/sessions/${sessionId}/images/${imageId}`;
