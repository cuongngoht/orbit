// An image for a chat message -- pasted, dropped or picked -- uploaded as its own bytes before the message is sent
// (POST /api/images, the one upload convention), with its progress. The message then names it by id.
import type { ImageRef } from "@orbit-web/contracts";
import { uploadFile } from "./upload";

export type UploadImage = (file: File, onProgress: (fraction: number) => void, signal?: AbortSignal) => Promise<ImageRef>;

export const uploadImage: UploadImage = (file, onProgress, signal) => uploadFile<ImageRef>("/api/images", file, onProgress, signal);
