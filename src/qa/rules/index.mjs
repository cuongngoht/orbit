// The families, as a table. Adding one is a row plus a file; no caller anywhere
// spells the names out -- the same shape src/learn/families/index.mjs uses.
//
// `shape` is not in this table. It is the hard stop that runs before all of
// them, because a rule cannot say anything useful about a container it cannot
// walk.
import { capabilityFindings } from "./capability.mjs";
import { coverFindings } from "./cover.mjs";
import { declaredFindings } from "./declared.mjs";
import { expectFindings } from "./expect.mjs";
import { freshnessFindings } from "./freshness.mjs";
import { idFindings } from "./ids.mjs";
import { linkFindings } from "./links.mjs";
import { manualFindings } from "./manual.mjs";
import { mutationFindings } from "./mutation.mjs";
import { permissionFindings } from "./permission.mjs";
import { placeFindings } from "./place.mjs";
import { repeatFindings } from "./repeat.mjs";
import { securityFindings } from "./security.mjs";

export const FAMILIES = {
  declared: declaredFindings,
  ids: idFindings,
  cover: coverFindings,
  expect: expectFindings,
  permission: permissionFindings,
  security: securityFindings,
  repeat: repeatFindings,
  mutation: mutationFindings,
  manual: manualFindings,
  links: linkFindings,
  freshness: freshnessFindings,
  capability: capabilityFindings,
  place: placeFindings,
};

export const FAMILY_NAMES = Object.keys(FAMILIES);
