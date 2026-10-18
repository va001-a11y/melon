import { lookup } from "node:dns/promises";
import { isIP } from "node:net";

/*
 * Where Melon's server is allowed to connect.
 *
 * Agents can point at any base URL -- custom endpoints, Ollama, LM Studio --
 * and the server fetches it on their behalf and hands back what it says. On a
 * desktop that is the user talking to their own machine. Run Melon in a
 * container on a cloud VM and expose it, though, and anyone who can reach it
 * can make it fetch http://169.254.169.254/ -- the instance metadata service,
 * which on most clouds hands out the machine's credentials -- and read the
 * reply. That is server-side request forgery, and it is the classic one.
 *
 * What is refused, and why it is so little:
 *
 * - Link-local addresses (169.254.0.0/16, fe80::/10) and AWS's IPv6 metadata
 *   address. That is where metadata services live, and nothing legitimate
 *   serves a language model there.
 *
 * - NOT private ranges. host.docker.internal is a private address, and so is
 *   an Ollama on another machine on the LAN. Refusing those would break the
 *   whole point of self-hosting Melon.
 *
 * - NOT localhost, for the same reason: that is where Ollama usually is.
 *
 * The check resolves the hostname rather than reading it, so a domain that
 * merely points at 169.254.169.254 is caught too. One gap is left knowingly:
 * fetch resolves the name again when it connects, so a DNS server that
 * answers differently the second time could slip past. Closing that needs a
 * custom connector, which is a lot of machinery for an attack that already
 * requires someone to be able to reach Melon and to run their own DNS.
 *
 * This runs only in the server. In the hosted build there is no server: the
 * browser makes the requests, as the user, and there is nothing to forge.
 */

function refused(address: string): boolean {
  const kind = isIP(address);
  if (kind === 4) return address.startsWith("169.254.");
  if (kind === 6) {
    const a = address.toLowerCase();
    // An IPv4 address wearing IPv6 clothes is still that IPv4 address. The
    // URL parser normalises it to hex -- [::ffff:169.254.169.254] arrives as
    // ::ffff:a9fe:a9fe -- so the dotted form alone would let it straight
    // past. A test caught exactly that.
    if (a.startsWith("::ffff:")) {
      const rest = a.slice(7);
      if (isIP(rest) === 4) return refused(rest);
      const hex = rest.match(/^([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
      if (hex) {
        const hi = parseInt(hex[1], 16);
        const lo = parseInt(hex[2], 16);
        return refused(`${hi >> 8}.${hi & 255}.${lo >> 8}.${lo & 255}`);
      }
    }
    return /^fe[89ab]/.test(a) || a === "fd00:ec2::254";
  }
  return false;
}

/** Thrown in place of a connection, so the reason reaches the user intact. */
export class RefusedDestination extends Error {}

export function guardOutboundFetch(): void {
  const original = globalThis.fetch;

  globalThis.fetch = async (input: string | URL | Request, init?: RequestInit) => {
    const raw = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;

    let url: URL;
    try {
      url = new URL(raw);
    } catch {
      return original(input, init); // let fetch report the bad URL itself
    }

    if (url.protocol !== "http:" && url.protocol !== "https:") {
      throw new RefusedDestination(`Melon only connects over http or https, not ${url.protocol}`);
    }

    // URL keeps the brackets on an IPv6 literal; the resolver wants it bare.
    const host = url.hostname.replace(/^\[|\]$/g, "");
    let addresses: { address: string }[] = [];
    try {
      addresses = await lookup(host, { all: true });
    } catch {
      // Unresolvable: fetch will fail with its own clearer message.
    }

    const bad = addresses.find((a) => refused(a.address));
    if (bad) {
      throw new RefusedDestination(
        `Melon will not connect to ${url.hostname} — it resolves to ${bad.address}, a link-local ` +
          `address. That range is where cloud servers keep their instance metadata, which can include ` +
          `credentials, and no AI service lives there.`
      );
    }

    return original(input, init);
  };
}
