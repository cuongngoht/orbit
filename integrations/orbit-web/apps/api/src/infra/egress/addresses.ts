// WHAT THE EGRESS PROXY NEVER REACHES, whatever a decision says: an address that is not on the public internet. It is
// decided AFTER the host's name was resolved, on the very address the connection is then made to (a name is never
// resolved twice), so a name that resolves to an internal address -- or answers otherwise the next time it is asked --
// reaches nothing it should not.
//
//   every run      this host's own addresses, loopback, link-local, the private, shared (CGNAT) and reserved ranges,
//                  multicast, IPv6 unique-local, every IPv6 range that carries an IPv4 address, and the cloud metadata
//                  service -- the last even when the installation names its range (ORBIT_WEB_EGRESS_PRIVATE_ALLOW), like
//                  loopback. A chat's or a research session's connection may reach another internal range the installation
//                  names; nothing else may.
//   an employee's  all of that, NO installation-named range (an employee works on the public internet only), and no
//                  IPv4-mapped IPv6 address at all.
import { BlockList, isIP } from "node:net";

// Every range that is not the public internet (IANA special-purpose registries) -- and, for IPv6, every range that
// carries an IPv4 address inside it (IPv4-compatible ::/96, NAT64 64:ff9b::/96, 6to4 2002::/16), which a gateway could
// turn into a connection to an IPv4 address no check above saw. (An IPv4-mapped address, ::ffff:a.b.c.d in any spelling,
// is held to the IPv4 ranges: a BlockList compares the two families as one. That is also why ::ffff:0:0/96 is never in
// this list: every IPv4 address would match it.)
const NOT_PUBLIC_V4 = ["0.0.0.0/8", "10.0.0.0/8", "100.64.0.0/10", "127.0.0.0/8", "169.254.0.0/16", "172.16.0.0/12", "192.0.0.0/24", "192.0.2.0/24", "192.88.99.0/24", "192.168.0.0/16", "198.18.0.0/15", "198.51.100.0/24", "203.0.113.0/24", "224.0.0.0/4", "240.0.0.0/4"];
const NOT_PUBLIC_V6 = ["::/96", "::1/128", "64:ff9b::/96", "64:ff9b:1::/48", "100::/64", "2001:db8::/32", "2002::/16", "fc00::/7", "fe80::/10", "ff00::/8"];

// The cloud providers' metadata services: AWS, Azure, Google Cloud and Oracle (169.254.169.254), AWS over IPv6
// (fd00:ec2::254), AWS ECS task metadata (169.254.170.2), Alibaba Cloud (100.100.100.200).
const METADATA_V4 = ["169.254.169.254/32", "169.254.170.2/32", "100.100.100.200/32"];
const METADATA_V6 = ["fd00:ec2::254/128"];

function blockOf(v4: readonly string[], v6: readonly string[] = []): BlockList {
  const list = new BlockList();
  for (const cidr of v4) list.addSubnet(cidr.split("/")[0] as string, Number(cidr.split("/")[1]), "ipv4");
  for (const cidr of v6) list.addSubnet(cidr.split("/")[0] as string, Number(cidr.split("/")[1]), "ipv6");
  return list;
}

const NOT_PUBLIC = blockOf(NOT_PUBLIC_V4, NOT_PUBLIC_V6);
const METADATA = blockOf(METADATA_V4, METADATA_V6);
// Only ever asked about an IPv6 address (it would match every IPv4 one).
const MAPPED = blockOf([], ["::ffff:0:0/96"]);

const familyOf = (a: string): "ipv4" | "ipv6" => (isIP(a) === 6 ? "ipv6" : "ipv4");

// `::ffff:a.b.c.d` as the IPv4 address it carries (how a resolver writes an IPv4-mapped address).
export const unmapped = (a: string): string => (a.toLowerCase().startsWith("::ffff:") && isIP(a.slice(7)) === 4 ? a.slice(7) : a);

// The internal ranges an installation explicitly lets a chat's or a research session's connections reach (still only
// where the policy allows): CIDR, IPv4.
export const allowedPrivate = (cidrs: readonly string[]): BlockList => blockOf(cidrs);

export function isMetadataAddress(address: string): boolean {
  const a = unmapped(address);
  return isIP(a) !== 0 && METADATA.check(a, familyOf(a));
}

// Addresses no connection may reach whatever the policy says: this host's own, the cloud metadata service, and every
// address that is not on the public internet -- unless the installation named its range in `allowed` (never loopback,
// never the metadata service).
export function forbiddenAddress(address: string, own: ReadonlySet<string>, allowed: BlockList | null = null): boolean {
  const a = unmapped(address);
  const family = familyOf(a);
  if (isIP(a) === 0 || own.has(a) || isMetadataAddress(a)) return true;
  if (!NOT_PUBLIC.check(a, family)) return false;
  return !(allowed !== null && family === "ipv4" && !a.startsWith("127.") && allowed.check(a, family));
}

// An employee's connection: the public internet only -- no range the installation named, and no IPv4-mapped IPv6
// address, whatever IPv4 address it carries.
export function forbiddenForEmployee(address: string, own: ReadonlySet<string>): boolean {
  if (isIP(address) === 6 && MAPPED.check(address, "ipv6")) return true;
  return forbiddenAddress(address, own, null);
}

// Why an address is refused, as the agent's program is told.
export function addressRefusal(host: string, address: string, employee: boolean): string {
  if (isMetadataAddress(address)) return `${host} resolves to ${address}, the cloud metadata service: never reached through the proxy`;
  if (employee && isIP(address) === 6 && MAPPED.check(address, "ipv6")) return `${host} resolves to ${address}, an IPv4-mapped IPv6 address: an employee's run never reaches one`;
  return `${host} resolves to ${address}, which is not on the public internet (or is Orbit Web's own host): never reached through the proxy`;
}
