// Shared bits of the query views. Printing is a view concern and stays here;
// a reading of the map is shared through graph/.
export const out = (...a) => console.log(...a);

export const flags = (s) => [s.dead && "DEAD", s.stub && "STUB", s.admin && "admin", s.seen && `seen:${s.seen}`].filter(Boolean).join(" ");

export const noScreen = (id) => out(`no screen "${id}" — try: query find ${id}`);
