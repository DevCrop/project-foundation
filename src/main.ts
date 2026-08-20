import { createServer } from "node:http";

const port = Number.parseInt(process.env.PORT ?? "3000", 10);

if (!Number.isInteger(port) || port < 1 || port > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const server = createServer((request, response) => {
  const status = request.url === "/health" ? 200 : 200;
  response.writeHead(status, { "content-type": "application/json; charset=utf-8" });
  response.end(JSON.stringify({ status: "ok", path: request.url ?? "/" }));
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Project Foundation example listening on ${port}`);
});

const shutdown = (): void => {
  server.close((error) => {
    if (error) {
      console.error(error);
      process.exitCode = 1;
    }
  });
};

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
