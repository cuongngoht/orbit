// Render before acquiring the publication lock. Readers see one complete page.
import { dirname } from 'node:path';
import { realIo } from '../store/io.mjs';
import { withLock } from '../store/lock.mjs';
import { writeAtomic } from '../store/atomic.mjs';
export function publish(file, html, io = realIo()) {
  io.ensureDir(dirname(file));
  return withLock(dirname(file), () => writeAtomic(file, html, io, false), io);
}
