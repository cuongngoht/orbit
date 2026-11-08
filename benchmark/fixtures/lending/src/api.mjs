// THE API, HTTP-shaped and free of any server: handle(store, { method, path, tenant, today, body }) -> { status, body }.
// `tenant` is the library system the caller signed in as -- the gateway in front of the service sets it -- and `today`
// the day the service's clock says it is. A refusal answers { error: <word> }.
import { isDay } from "./dates.mjs";
import { isKey } from "./store.mjs";
import { allMine, isTenant, mine } from "./tenancy.mjs";
import { copyView, isFormat, newCopy, newTitle, titleView } from "./catalog.mjs";
import { memberView, newMember } from "./members.mjs";
import { lendRefusal, lent, loanView, renewed, renewRefusal, returned } from "./loans.mjs";
import { holdView, newHold, noticeView, openHoldOf } from "./holds.mjs";

const answer = (status, body) => ({ status, body });

const refused = (status, error) => answer(status, { error });

const found = (record, error, view) => (record ? answer(200, view(record)) : refused(404, error));

const isName = (v) => typeof v === "string" && v.trim().length > 0 && v.length <= 200;

const isCents = (v) => Number.isInteger(v) && v >= 0 && v <= 10000000;

// ---- the catalogue and the members ------------------------------------------------------------------------------------

const titleAdded = (c) => (isName(c.body.name) && isFormat(c.body.format) ? answer(201, titleView(newTitle(c.store, c.tenant, c.body))) : refused(400, "bad-title"));

const copyOfTitle = (c, title) => (title ? answer(201, copyView(newCopy(c.store, c.tenant, title, c.body))) : refused(404, "no-title"));

const copyAdded = (c) => (isKey(c.body.title) && isCents(c.body.replacementCents) ? copyOfTitle(c, mine(c.store, c.tenant, "titles", c.body.title)) : refused(400, "bad-copy"));

const memberAdded = (c) => (isName(c.body.name) ? answer(201, memberView(newMember(c.store, c.tenant, c.body))) : refused(400, "bad-member"));

const noticesOf = (c, member) => answer(200, { notices: allMine(c.store, c.tenant, "notices").filter((n) => n.member === member.id).map(noticeView) });

const notices = (c, [id]) => ((m) => (m ? noticesOf(c, m) : refused(404, "no-member")))(mine(c.store, c.tenant, "members", id));

// ---- lending, returns and renewals ------------------------------------------------------------------------------------

const lendOrNot = (c, copy, member) => ((why) => (why ? refused(409, why) : answer(201, loanView(lent(c.store, c.tenant, copy, member, c.today)))))(lendRefusal(c.store, c.tenant, copy, member));

function lend(c) {
  const copy = mine(c.store, c.tenant, "copies", c.body.copy);
  const member = mine(c.store, c.tenant, "members", c.body.member);
  if (!copy || !member) return refused(404, copy ? "no-member" : "no-copy");
  return lendOrNot(c, copy, member);
}

const loanOf = (c, id) => mine(c.store, c.tenant, "loans", id);

const giveBack = (c, loan) => (loan.returned ? refused(409, "returned") : answer(200, loanView(returned(c.store, c.tenant, loan, c.today))));

const back = (c, [id]) => ((loan) => (loan ? giveBack(c, loan) : refused(404, "no-loan")))(loanOf(c, id));

const renewOrNot = (c, loan) => ((why) => (why ? refused(409, why) : answer(200, loanView(renewed(c.store, c.tenant, loan)))))(renewRefusal(c.store, c.tenant, loan, c.today));

const renew = (c, [id]) => ((loan) => (loan ? renewOrNot(c, loan) : refused(404, "no-loan")))(loanOf(c, id));

// ---- holds ------------------------------------------------------------------------------------------------------------

const holdOrNot = (c, title, member) => (openHoldOf(c.store, c.tenant, title, member) ? refused(409, "duplicate-hold") : answer(201, holdView(newHold(c.store, c.tenant, title, member, c.today))));

function hold(c) {
  const title = mine(c.store, c.tenant, "titles", c.body.title);
  const member = mine(c.store, c.tenant, "members", c.body.member);
  if (!title || !member) return refused(404, title ? "no-member" : "no-title");
  return holdOrNot(c, title, member);
}

// ---- the routes -------------------------------------------------------------------------------------------------------

const ROUTES = [
  ["GET", /^\/titles$/, (c) => answer(200, { titles: allMine(c.store, c.tenant, "titles").map(titleView) })],
  ["POST", /^\/titles$/, titleAdded],
  ["GET", /^\/titles\/([^/]+)$/, (c, [id]) => found(mine(c.store, c.tenant, "titles", id), "no-title", titleView)],
  ["POST", /^\/copies$/, copyAdded],
  ["GET", /^\/copies\/([^/]+)$/, (c, [id]) => found(mine(c.store, c.tenant, "copies", id), "no-copy", copyView)],
  ["POST", /^\/members$/, memberAdded],
  ["GET", /^\/members\/([^/]+)$/, (c, [id]) => found(mine(c.store, c.tenant, "members", id), "no-member", memberView)],
  ["GET", /^\/members\/([^/]+)\/notices$/, notices],
  ["POST", /^\/loans$/, lend],
  ["GET", /^\/loans\/([^/]+)$/, (c, [id]) => found(loanOf(c, id), "no-loan", loanView)],
  ["POST", /^\/loans\/([^/]+)\/return$/, back],
  ["POST", /^\/loans\/([^/]+)\/renew$/, renew],
  ["POST", /^\/holds$/, hold],
  ["GET", /^\/holds\/([^/]+)$/, (c, [id]) => found(mine(c.store, c.tenant, "holds", id), "no-hold", holdView)],
];

const routed = (req) => ROUTES.map(([method, path, run]) => ({ run, m: method === req.method ? path.exec(String(req.path)) : null })).find((r) => r.m) ?? null;

const bodyOf = (req) => (req.body && typeof req.body === "object" && !Array.isArray(req.body) ? req.body : {});

export function handle(store, req) {
  if (!isTenant(req?.tenant)) return refused(401, "no-tenant");
  if (!isDay(req.today)) return refused(400, "bad-day");
  const r = routed(req);
  return r ? r.run({ store, tenant: req.tenant, today: req.today, body: bodyOf(req) }, r.m.slice(1)) : refused(404, "no-route");
}
