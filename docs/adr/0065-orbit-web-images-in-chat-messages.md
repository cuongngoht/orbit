# ADR 0065 — Orbit Web: images in a chat message, uploaded first, given to Claude Code as stream-json

## Status

Accepted (Orbit Web 0.8.0), 2026-11-20, the owner's request ("thêm tính năng copy hình vào chat như chụp màn hình thì
copy vào chat": a screenshot pasted into the chat goes with the message). For Orbit Web only; no engine contract
changes, the plugin stays 0.6.0 and its archive is unchanged.

## Context

1. A chat message was words: the composer had no way to take a picture, and Claude Code was given the prompt as text on
   stdin. People debug from screenshots.
2. The Claude CLI takes an image headless only inside a stream-json user message (`--input-format stream-json`, an
   `image` content block holding the bytes as base64). Checked with Claude Code 2.1.328 before anything was built: a red
   square sent that way was answered "Red".
3. The API's bodies are JSON with a 256 KB bound; an image is megabytes. Research already uploads a file as its own bytes
   on one route the mutation guard names (ADR 0064).
4. In the governed deployment the run's stdin crosses the runner protocol, whose frames are bounded (4 MB).

## Decision

**An image is uploaded first, as its own bytes, and a message names it.** `POST /api/images` takes the file's bytes
(`application/octet-stream`); the mutation guard's raw-upload exception is now a table of exactly two routes (a research
source, a chat image), each still under the change header and the origin rules. What the image is, is read from its
first bytes -- PNG, JPEG, GIF or WebP, never SVG -- and it is held to Claude's own limits (6 a message, 5 MB, 8000 pixels
a side), checked again in the page before it leaves. It is kept as `/data/app/images/<id>` -- the control plane's room,
beside the database, refused to the agent -- written whole and renamed, named by an id the server made, and recorded as
the uploading account's.

**An image goes with one message, in one chat.** A message (`POST /api/sessions/:id/messages`, or a new chat's first
message) may name only its sender's own unsent uploads; they are claimed for the chat and attached to the message, in
order. They are read back only through the chat (`GET /api/sessions/:id/images/:image`, under the chat's access rule,
`nosniff`, `default-src 'none'`). A shared link's snapshot keeps the words and drops the images and their ids. An upload
no chat claims is swept after a day; a chat's images go with it.

**Claude Code is given the images with the words.** A message with images starts the run with `--input-format
stream-json` and one user message on stdin (the words, when there are any, then each image as base64); a message
without images is the prompt's own text, exactly as before. Events and logs keep an image's id and kind, never its bytes.
The runner protocol carries a long stdin in frames under its bound, never cutting a character in two.

**Research takes no image.** Its runs read only the passages retrieved for them (ADR 0064); its composer offers none.

## Consequences

- A screenshot can be pasted, dropped or picked, shows as a thumbnail with its upload's progress, and is seen by Claude.
- **Said plainly.** An image goes to Claude (Anthropic) with the words, like everything else in a chat. Images are kept
  on the server until their chat is deleted (or, never sent, for a day), and a backup holds them (`/data/app`). The limits
  are Claude's and are not settings. HEIC and other formats Claude does not read are refused in the page; convert first.
  Nothing edits or annotates an image.
