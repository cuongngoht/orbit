// A REQUEST'S BODY AS BYTES: the one kind of body besides JSON the API takes -- an upload, the file's own bytes
// (application/octet-stream), on the routes the mutation guard names (a research source, a chat image). At most `limit`
// bytes: refused with `tooLarge` when the request says more, or as soon as more arrives.
import type { Request } from "express";
import { ApiError } from "./errors.js";

export function readRawBody(req: Request, limit: number, tooLarge: (limit: number) => ApiError): Promise<Buffer> {
  const declared = Number(req.headers["content-length"] ?? Number.NaN);
  if (Number.isFinite(declared) && declared > limit) return Promise.reject(tooLarge(limit));
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let over = false;
    req.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) over = true;
      if (!over) chunks.push(chunk);
    });
    req.on("end", () => (over ? reject(tooLarge(limit)) : resolve(Buffer.concat(chunks))));
    req.on("error", () => reject(new ApiError(400, "invalid_request", "The upload was cut off.")));
  });
}
