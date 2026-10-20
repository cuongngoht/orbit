// Where the Skills feature lives in the URL. Other features link here through
// these, never by spelling the path themselves.
export const SKILLS_PATH = "/skills";

export const editPath = (id: string) => `${SKILLS_PATH}/${encodeURIComponent(id)}`;

export const filteredPath = (show: string) => `${SKILLS_PATH}?show=${encodeURIComponent(show)}`;
