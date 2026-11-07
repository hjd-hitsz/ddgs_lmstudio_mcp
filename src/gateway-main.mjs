import { readGatewayConfiguration } from "./gateway-configuration.mjs";
import { createGateway } from "./gateway.mjs";

const config = await readGatewayConfiguration();
const server = createGateway(config);
server.listen(config.port, "127.0.0.1", () =>
  console.error(`搜索网关已监听 127.0.0.1:${server.address().port}`),
);
for (const signal of ["SIGINT", "SIGTERM"])
  process.once(signal, () => {
    server.close();
    server.closeAllConnections();
  });
