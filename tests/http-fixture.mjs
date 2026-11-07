import http from "node:http";
import { join } from "node:path";
import { randomUUID } from "node:crypto";
import { createGateway } from "../src/gateway.mjs";
import { createRelayLease } from "../src/relay-lease.mjs";
import { installHttpHook } from "../src/http-hook.mjs";

export async function hookedServer(t, directory, handler, search) {
  const token = randomUUID(),
    leasePath = join(directory, "relay.sock");
  const upstream = http.createServer(handler);
  await new Promise((resolve) => upstream.listen(0, "127.0.0.1", resolve));
  const url = `http://127.0.0.1:${upstream.address().port}`;
  const lease = await createRelayLease(leasePath, token);
  const gateway = createGateway({
    relayToken: token,
    upstreamUrl: url,
    search,
  });
  await new Promise((resolve) => gateway.listen(0, "127.0.0.1", resolve));
  await installHttpHook({
    apiPort: upstream.address().port,
    relayPort: gateway.address().port,
    leasePath,
    token,
  });
  t.after(async () => {
    await lease.close();
    for (const server of [gateway, upstream]) {
      server.closeAllConnections();
      await new Promise((resolve) => server.close(resolve));
    }
  });
  return { url, upstream, gateway, lease };
}
