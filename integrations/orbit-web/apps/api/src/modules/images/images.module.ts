// /api/images -- an image for a chat message, uploaded as its own bytes (application/octet-stream: the mutation guard
// lets this one route's octet-stream through, under the same header and origin rules as any change) -- and
// /api/sessions/:id/images/:imageId, an image a chat's message carried, read by whoever may read that chat (the chat
// access check holds every route under /api/sessions/<id>).
import { Controller, Get, HttpCode, Inject, Module, Param, Post, Req, Res } from "@nestjs/common";
import { IMAGE_LIMITS, type ImageRef } from "@orbit-web/contracts";
import type { Request, Response } from "express";
import { ApiError } from "../../common/errors.js";
import { readRawBody } from "../../common/raw-body.js";
import { viewer } from "../../common/request-scope.js";
import { imageTooLarge, ImagesService } from "./images.service.js";

const EXTENSIONS: Record<ImageRef["mediaType"], string> = { "image/png": "png", "image/jpeg": "jpg", "image/gif": "gif", "image/webp": "webp" };

@Controller()
export class ImagesController {
  constructor(@Inject(ImagesService) private readonly images: ImagesService) {}

  @Post("images")
  @HttpCode(201)
  async upload(@Req() req: Request): Promise<ImageRef> {
    const who = viewer();
    if (!String(req.headers["content-type"] ?? "").startsWith("application/octet-stream")) throw new ApiError(415, "octet_stream_required", "Send the image's own bytes as application/octet-stream.");
    return this.images.upload(await readRawBody(req, IMAGE_LIMITS.bytes, imageTooLarge), who);
  }

  @Get("sessions/:id/images/:imageId")
  async image(@Param("id") id: string, @Param("imageId") imageId: string, @Res() res: Response): Promise<void> {
    const { image, bytes } = await this.images.sent(id, imageId);
    res.set({
      "Content-Type": image.mediaType,
      "Content-Length": String(bytes.length),
      "Content-Disposition": `inline; filename="image.${EXTENSIONS[image.mediaType]}"`,
      "Cache-Control": "private, max-age=86400",
      "X-Content-Type-Options": "nosniff",
      "Content-Security-Policy": "default-src 'none'",
    });
    res.end(bytes);
  }
}

@Module({
  providers: [ImagesService],
  controllers: [ImagesController],
  exports: [ImagesService],
})
export class ImagesModule {}
