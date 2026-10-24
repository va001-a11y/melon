/**
 * The server's outbound guard (v0.6.3). Run in Docker on a cloud machine,
 * Melon could be asked to fetch the address where clouds keep instance
 * credentials. The guard refuses those addresses — and must still let
 * through the private addresses Ollama and LAN setups live on, or the fix
 * would break the reason people run Melon locally.
 */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";
import { guardOutboundFetch, RefusedDestination } from "../server/src/outbound.ts";

let server: http.Server;
let port = 0;

before(async () => {
  server = http.createServer((_q, s) => {
    s.writeHead(200);
    s.end("ok");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
  port = (server.address() as AddressInfo).port;
  guardOutboundFetch();
});
after(() => server.close());

/** Whether the guard refused, as distinct from the address simply not answering. */
async function refused(url: string): Promise<boolean> {
  try {
    await fetch(url, { signal: AbortSignal.timeout(1500) });
    return false;
  } catch (e) {
    return e instanceof RefusedDestination;
  }
}

for (const [label, url] of [
  ["cloud metadata, IPv4", "http://169.254.169.254/latest/meta-data/"],
  ["any link-local IPv4", "http://169.254.1.1/"],
  ["link-local IPv6", "http://[fe80::1]/"],
  ["AWS metadata over IPv6", "http://[fd00:ec2::254]/"],
  ["metadata disguised as IPv4-mapped IPv6", "http://[::ffff:169.254.169.254]/"],
  ["the same, written in hex", "http://[::ffff:a9fe:a9fe]/"],
  ["a file: URL", "file:///etc/passwd"],
]) {
  test(`refused: ${label}`, async () => {
    assert.equal(await refused(url), true);
  });
}

test("allowed: loopback by IP and by name, where Ollama usually is", async () => {
  assert.equal(await refused(`http://127.0.0.1:${port}/`), false);
  assert.equal(await refused(`http://localhost:${port}/`), false);
});

for (const [label, url] of [
  ["a private LAN address", "http://10.255.255.1:11434/"],
  ["Docker's host gateway range", "http://172.17.0.1:11434/"],
  ["Docker Desktop's host range", "http://192.168.65.254:11434/"],
]) {
  test(`allowed: ${label}`, async () => {
    assert.equal(await refused(url), false);
  });
}
