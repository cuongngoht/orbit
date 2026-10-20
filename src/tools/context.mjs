// A DETECTION CONTEXT: what src/tools/detect.mjs asks a machine through -- the real effects
// (src/tools/real.mjs), the project a project-local tool would sit in, and what a caller adds: the
// rooms its receipts sit in, the detectors a composition root registers, a clock, a home. One
// builder, so the composition roots that need one cannot drift apart about its shape.
//
// The environment is the caller's to hand in: a composition root reads it, nothing here does.
import { realDetection } from "./real.mjs";

export const detectionContext = ({ env, projectRoot = null, ...more }) => ({ ...realDetection(env), projectRoot, ...defined(more) });

const defined = (fields) => Object.fromEntries(Object.entries(fields).filter(([, v]) => v !== undefined));
