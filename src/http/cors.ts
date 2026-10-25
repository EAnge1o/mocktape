/** CORS headers added to every response when `cors` is enabled. */
export function corsHeaders(request: Record<string, string>): Record<string, string> {
  const requestedHeaders = request["access-control-request-headers"];
  return {
    "access-control-allow-origin": request["origin"] ?? "*",
    "access-control-allow-methods": "GET,HEAD,POST,PUT,PATCH,DELETE,OPTIONS",
    "access-control-allow-headers": requestedHeaders ?? "*",
    "access-control-max-age": "86400",
    vary: "Origin",
  };
}
