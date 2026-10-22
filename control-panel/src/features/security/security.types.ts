// Security catalogs as control-server answers them (control-server/src/security-catalogs/, ADR 0040).

export interface CatalogListed {
  catalog: string;
  version: string;
  title: string;
  digest: string;
  controls: number;
  default?: boolean;
}

export interface Refusal {
  from: string;
  layer: string;
  problems: string[];
}

export interface Enabled {
  catalog: string;
  digest: string;
  levels?: number[];
  groups?: string[];
}

export interface Mark {
  catalog: string;
  control: string;
  why: string;
  at: string | null;
}

export interface InEffect {
  catalog: string;
  version: string;
  digest: string;
  layer: string;
  filter: { levels: number[] | null; groups: string[] | null } | null;
  controls: number;
}

export interface SecurityOverview {
  available: true;
  checkout: { name: string } | null;
  shipped: CatalogListed[];
  adopted: CatalogListed[];
  refused: Refusal[];
  index: { revision: string | null; unreadable: string | null };
  project: {
    available: boolean;
    revision: string | null;
    enabled: Enabled[];
    notApplicable: Mark[];
    effective: { by: "default" | "project"; catalogs: InEffect[]; missing: { catalog: string; digest: string; why: string }[] };
  };
}

export interface Preview {
  ok: boolean;
  problems: string[];
  catalog?: string;
  version?: string;
  title?: string;
  digest?: string;
  controls?: number;
  against?: { digest: string; version: string; layer: string } | null;
  same?: boolean;
  diff?: { added: string[]; removed: string[]; changed: string[] };
}

export type CatalogSource = { url: string } | { text: string; name?: string };

export interface CatalogDocument {
  catalog: string;
  version: string;
  digest: string;
  layer: string;
  document: { controls: { id: string; summary: string; group?: string }[] };
}
