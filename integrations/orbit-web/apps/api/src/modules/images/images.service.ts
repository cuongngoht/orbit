// IMAGES IN CHAT MESSAGES. An upload is the image's own bytes: what it is is read from them (sniff.ts), it is held to
// Claude's own limits, kept as a file named by an id the server makes, and recorded as the uploading account's. A
// message names its images by id: each must be the sender's, and unsent -- an image goes with one message, in one chat,
// and is read by whoever may read that chat. What no chat claims within a day is swept, with its file; a chat's images
// go with the chat.
import { createHash, randomUUID } from "node:crypto";
import { Inject, Injectable, Logger, type OnApplicationShutdown, type OnModuleInit } from "@nestjs/common";
import { IMAGE_LIMITS, type ImageRef } from "@orbit-web/contracts";
import { ApiError, conflict, notFound } from "../../common/errors.js";
import { ImageFiles } from "../../infra/storage/image-files.js";
import { imageRefOf, ImageStore, type ImageRecord } from "../../infra/storage/stores.js";
import type { Identity } from "../claude-auth/claude-auth.service.js";
import { requireIdentity } from "../access/ownership.service.js";
import { sniffImage } from "./sniff.js";

// An upload no chat claimed is kept this long, then swept; the sweep runs at start and every hour.
export const UNCLAIMED_MS = 24 * 60 * 60 * 1000;
const SWEEP_EVERY_MS = 60 * 60 * 1000;
// A write cut short (its .part file) is left alone this long.
const LEFTOVER_MS = 60 * 60 * 1000;

export const imageTooLarge = (limit: number): ApiError => new ApiError(413, "image_too_large", `An image may be at most ${Math.round(limit / 1_048_576)} MB.`);

@Injectable()
export class ImagesService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger("Images");
  private sweeper: NodeJS.Timeout | null = null;

  constructor(
    @Inject(ImageStore) private readonly images: ImageStore,
    @Inject(ImageFiles) private readonly files: ImageFiles,
  ) {}

  onModuleInit(): void {
    void this.sweep();
    this.sweeper = setInterval(() => void this.sweep(), SWEEP_EVERY_MS);
    this.sweeper.unref();
  }

  onApplicationShutdown(): void {
    if (this.sweeper !== null) clearInterval(this.sweeper);
  }

  async upload(bytes: Buffer, identity: Identity | null): Promise<ImageRef> {
    const who = requireIdentity(identity);
    if (bytes.length === 0) throw new ApiError(400, "invalid_request", "The image is empty.");
    if (bytes.length > IMAGE_LIMITS.bytes) throw imageTooLarge(IMAGE_LIMITS.bytes);
    const kind = sniffImage(bytes);
    if (kind === null) throw new ApiError(415, "unsupported_image", "That is not an image Claude reads: PNG, JPEG, GIF or WebP.");
    if (kind.width === 0 || kind.height === 0 || (kind.width ?? 0) > IMAGE_LIMITS.side || (kind.height ?? 0) > IMAGE_LIMITS.side)
      throw new ApiError(422, "image_dimensions", `An image may be at most ${IMAGE_LIMITS.side} pixels on a side.`);
    const id = randomUUID();
    await this.files.put(id, bytes);
    const record = { id, ownerEmail: who.email, ownerOrg: who.org, mediaType: kind.mediaType, width: kind.width, height: kind.height, bytes: bytes.length, sha256: createHash("sha256").update(bytes).digest("hex"), createdAt: new Date().toISOString() };
    this.images.insert(record);
    return imageRefOf({ ...record, sessionId: null, messageId: null, position: null });
  }

  // The images a person names for a message: each theirs, uploaded and unsent, and not another chat's. Refused whole.
  owned(ids: readonly string[], identity: Identity | null, sessionId: string | null): ImageRecord[] {
    if (ids.length === 0) return [];
    const who = requireIdentity(identity);
    return ids.map((id) => {
      const image = this.images.get(id);
      // Somebody else's image is not found here: whether it exists is theirs to know.
      if (image === null || image.ownerEmail !== who.email || image.ownerOrg !== who.org) throw notFound("Image");
      if (image.messageId !== null || (image.sessionId !== null && image.sessionId !== sessionId)) throw conflict("image_sent", "That image was already sent with a message: paste it again to send it again.");
      return image;
    });
  }

  // Checked as `owned`, then claimed for the chat (still unsent).
  claim(ids: readonly string[], identity: Identity | null, sessionId: string): ImageRef[] {
    const images = this.owned(ids, identity, sessionId);
    this.images.claim(ids, sessionId);
    return images.map(imageRefOf);
  }

  // One image of a chat, as it was sent: its kind and bytes (the chat's own access rule was held before this).
  sent(sessionId: string, imageId: string): { image: ImageRef; bytes: Buffer } {
    const image = this.images.get(imageId);
    if (image === null || image.sessionId !== sessionId || image.messageId === null) throw notFound("Image");
    return { image: imageRefOf(image), bytes: this.files.read(image.id) };
  }

  // Unclaimed uploads past their day, files nothing names, and writes cut short.
  async sweep(now = Date.now()): Promise<number> {
    try {
      const stale = this.images.unclaimedSince(new Date(now - UNCLAIMED_MS).toISOString());
      this.images.remove(stale);
      await this.files.remove(stale);
      const files = await this.files.list();
      const named = this.images.known(files.filter((f) => f.image).map((f) => f.name));
      const orphans = files.filter((f) => f.image && !named.has(f.name) && now - f.changedMs > UNCLAIMED_MS).map((f) => f.name);
      await this.files.remove(orphans);
      for (const f of files.filter((x) => !x.image && now - x.changedMs > LEFTOVER_MS)) await this.files.removeLeftover(f.name);
      return stale.length + orphans.length;
    } catch (err) {
      this.logger.warn(`the image sweep stopped: ${err instanceof Error ? err.message : String(err)}`);
      return 0;
    }
  }
}
