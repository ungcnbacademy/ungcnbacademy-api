const http = require("http");
const { readFileSync } = require("fs");
const { join } = require("path");

const port = Number(process.env.PORT || 3000);
const html = readFileSync(join(__dirname, "index.html"));

const server = http.createServer((request, response) => {
  if (request.url === "/health") {
    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(JSON.stringify({ ok: true }));
    return;
  }

  response.writeHead(200, {
    "content-type": "text/html; charset=utf-8",
    "cache-control": "no-store"
  });
  response.end(html);
});

server.listen(port, "0.0.0.0", () => {
  console.log(`Under construction page listening on ${port}`);
});
