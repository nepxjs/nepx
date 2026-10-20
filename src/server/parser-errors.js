import http from "node:http";
import { plainStatusHtml } from "../errors/index.js";

/** What llhttp / Node report for requests rejected before any handler runs. */
const PARSER_STATUS = { HPE_HEADER_OVERFLOW: 431, ERR_HTTP_REQUEST_TIMEOUT: 408, HPE_INVALID_VERSION: 505, HPE_INVALID_METHOD: 501, HPE_URI_TOO_LONG: 414 };

/** Answer those with a real status page instead of a bare "400 Bad Request", then close the connection. */
export function handleParserErrors(server) {
  server.on("clientError", (err, socket) => {
    if (!socket.writable) return;
    const status = PARSER_STATUS[err.code] ?? 400;
    const body = plainStatusHtml(status);
    socket.end(`HTTP/1.1 ${status} ${http.STATUS_CODES[status]}\r\ncontent-type: text/html; charset=utf-8\r\ncontent-length: ${Buffer.byteLength(body)}\r\ncache-control: no-store\r\nx-content-type-options: nosniff\r\nx-frame-options: SAMEORIGIN\r\nconnection: close\r\n\r\n${body}`);
  });
}
