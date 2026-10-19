// IP allow / deny lists with CIDR support (IPv4 + IPv6), global and per path.
import { BlockList, isIP } from "node:net";
import { NepxError } from "../errors/index.js";
import { compilePattern } from "../rules.js";

function toList(entries, where) {
  const list = new BlockList();
  let size = 0;
  for (const raw of entries ?? []) {
    if (typeof raw !== "string") throw new NepxError(`${where}: entries must be strings (IP or CIDR), got ${JSON.stringify(raw)}`);
    const [addr, bits] = raw.split("/");
    const family = isIP(addr);
    if (!family) throw new NepxError(`${where}: ${JSON.stringify(raw)} is not an IP address or CIDR range`);
    const type = family === 4 ? "ipv4" : "ipv6";
    if (bits === undefined) list.addAddress(addr, type);
    else {
      const n = Number(bits);
      if (!Number.isInteger(n) || n < 0 || n > (family === 4 ? 32 : 128)) throw new NepxError(`${where}: invalid prefix length in ${JSON.stringify(raw)}`);
      list.addSubnet(addr, n, type);
    }
    size++;
  }
  return { list, size };
}

const matches = ({ list, size }, ip) => {
  if (!size) return false;
  const family = isIP(ip);
  return family ? list.check(ip, family === 4 ? "ipv4" : "ipv6") : false;
};

/**
 * Validate + compile `config.security.ipAccess`:
 *   { allow?: string[], deny?: string[], rules?: [{ source, allow?, deny? }] }
 * deny always wins; when an allow list exists, everything else is refused. The first matching rule (by path) replaces the global lists.
 */
export function compileAccessList(input) {
  if (!input) return null;
  if (typeof input !== "object" || Array.isArray(input)) throw new NepxError("config.security.ipAccess must be an object { allow, deny, rules }");
  const global = { allow: toList(input.allow, "config.security.ipAccess.allow"), deny: toList(input.deny, "config.security.ipAccess.deny") };
  const rules = (input.rules ?? []).map((r, i) => {
    if (!r || typeof r.source !== "string") throw new NepxError(`config.security.ipAccess.rules[${i}] needs a "source" path pattern`);
    return { match: compilePattern(r.source), allow: toList(r.allow, `config.security.ipAccess.rules[${i}].allow`), deny: toList(r.deny, `config.security.ipAccess.rules[${i}].deny`) };
  });
  if (!global.allow.size && !global.deny.size && !rules.length) return null;
  return {
    /** -> true when this IP may access the path */
    permits(ip, pathname) {
      const scope = rules.find((r) => r.match(pathname)) ?? global;
      if (matches(scope.deny, ip)) return false;
      return scope.allow.size ? matches(scope.allow, ip) : true;
    },
  };
}
