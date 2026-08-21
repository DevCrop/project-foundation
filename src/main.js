import { createServer } from "node:http";

const port = Number(process.env.PORT ?? 3000);

createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json" });
    response.end('{"status":"ok"}');
    return;
  }
  response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
  response.end("Project Foundation\n");
}).listen(port, "0.0.0.0");
