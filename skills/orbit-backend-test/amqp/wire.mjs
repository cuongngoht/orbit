// Frames: the protocol header, the four frame types and their end octet, a
// body split at the negotiated frame-max, and a STREAMING parser -- a socket
// hands over whatever bytes arrived, half a frame included, and the parser
// keeps the rest for the next chunk.
import { decodeHeader, encodeHeader } from "./content.mjs";
import { protocolError } from "./errors.mjs";
import { decodeMethod, encodeMethod } from "./methods.mjs";
import { u16, u32, u8 } from "./table.mjs";

export const PROTOCOL_HEADER = Buffer.from([0x41, 0x4d, 0x51, 0x50, 0, 0, 9, 1]);
export const FRAME_END = 0xce;
export const FRAMES = [
  { kind: "method", type: 1, decode: (p) => decodeMethod(p) },
  { kind: "header", type: 2, decode: (p) => decodeHeader(p) },
  { kind: "body", type: 3, decode: (p) => p },
  { kind: "heartbeat", type: 8, decode: () => null },
];

const BY_TYPE = new Map(FRAMES.map((f) => [f.type, f]));
const TYPE = Object.fromEntries(FRAMES.map((f) => [f.kind, f.type]));
const BASIC_CLASS = 60;
const MAX_FRAME = 1 << 27;

export const frame = (type, channel, payload) => Buffer.concat([u8(type), u16(channel), u32(payload.length), payload, u8(FRAME_END)]);
export const methodFrame = (channel, name, args) => frame(TYPE.method, channel, encodeMethod(name, args));
export const headerFrame = (channel, bodySize, properties) => frame(TYPE.header, channel, encodeHeader(BASIC_CLASS, bodySize, properties));
export const heartbeatFrame = () => frame(TYPE.heartbeat, 0, Buffer.alloc(0));

// A frame carries frame-max bytes in all, eight of them its own envelope; a
// frame-max of 0 means the broker set no limit, so the body travels whole.
const chunkSize = (frameMax, length) => (frameMax > 8 ? frameMax - 8 : Math.max(length, 1));
const pieces = (buf, size) => Array.from({ length: Math.ceil(buf.length / size) }, (_, i) => buf.subarray(i * size, (i + 1) * size));
export const bodyFrames = (channel, body, frameMax) => pieces(body, chunkSize(frameMax, body.length)).map((p) => frame(TYPE.body, channel, p));
export const contentFrames = (channel, body, properties, frameMax) => [headerFrame(channel, body.length, properties), ...bodyFrames(channel, body, frameMax)];

export const decodeFrame = (f) => BY_TYPE.get(f.type).decode(f.payload);

export function createParser(onFrame, maxFrame = MAX_FRAME) {
  const state = { buf: Buffer.alloc(0), maxFrame };
  return { push: (chunk) => drain(state, Buffer.concat([state.buf, chunk]), onFrame), buffered: () => state.buf.length };
}

// What remains is saved BEFORE a frame is handed on, so a handler that throws
// never leaves a frame it already consumed to be parsed a second time.
function drain(state, buf, onFrame) {
  state.buf = buf;
  for (let f = next(state.buf, state.maxFrame); f; f = next(state.buf, state.maxFrame)) {
    state.buf = state.buf.subarray(f.length);
    onFrame(f.frame);
  }
}

function next(buf, maxFrame) {
  if (buf.length < 7) return null;
  refuseProtocolHeader(buf);
  const size = buf.readUInt32BE(3);
  if (size > maxFrame) throw protocolError(`a ${size}-byte frame is larger than the ${maxFrame} bytes this client accepts`);
  return buf.length < size + 8 ? null : frameAt(buf, size);
}

// A broker that does not speak 0-9-1 answers with ITS protocol header and
// closes: that is a refusal of the version, never a frame.
function refuseProtocolHeader(buf) {
  if (buf.subarray(0, 4).toString("latin1") === "AMQP") throw protocolError(`the broker answered with its own protocol header (${[...buf.subarray(4, 8)].join(".")}): it does not speak AMQP 0-9-1`);
}

function frameAt(buf, size) {
  if (buf[size + 7] !== FRAME_END) throw protocolError(`a ${size}-byte frame does not end with the frame-end octet`);
  if (!BY_TYPE.has(buf[0])) throw protocolError(`unknown frame type ${buf[0]}`);
  return { length: size + 8, frame: { type: buf[0], kind: BY_TYPE.get(buf[0]).kind, channel: buf.readUInt16BE(1), payload: Buffer.from(buf.subarray(7, 7 + size)) } };
}
