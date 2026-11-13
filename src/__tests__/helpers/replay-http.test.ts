import { describe, it, expect } from "vitest";
import { createReplayHttpClient } from "./replay-http.js";
import { HttpError } from "../../scrapers/shared/http/http-error.js";

const L = "https://api.test/list";
const D = "https://api.test/e/1";

describe("createReplayHttpClient", () => {
  it("replays routes with the real client's error texts and records calls", async () => {
    const boom = new HttpError("timeout", D, null, `fetch timeout 10000ms ${D}`);
    const r = createReplayHttpClient({
      [L]: { body: '{"events":[1]}' },
      [D]: boom,
      "https://api.test/404": { status: 404, body: "nope", contentType: "text/html" },
      "https://api.test/html": { body: "<p>", contentType: "text/html" },
    });
    expect(await r.getJson(L)).toEqual({ events: [1] });
    expect(await r.getText(L)).toBe('{"events":[1]}');
    await expect(r.getJson(D)).rejects.toBe(boom);
    await expect(r.getJson("https://api.test/404")).rejects.toMatchObject({
      kind: "http",
      status: 404,
      message: "fetch HTTP 404 https://api.test/404",
      bodySnippet: "nope",
    });
    await expect(r.getJson("https://api.test/html")).rejects.toThrow("fetch non-JSON text/html https://api.test/html");
    await expect(r.getJson("https://api.test/none")).rejects.toThrow("replay-http: no route for https://api.test/none");
    await expect(r.getJson(L, { signal: AbortSignal.abort() })).rejects.toThrow(`fetch aborted ${L}`);
    expect(r.calls).toEqual([L, L, D, "https://api.test/404", "https://api.test/html", "https://api.test/none"]);
    expect(r.stats).toEqual({ requests: 6, retries: 0, failures: 5, bytes: 35, byStatus: { "200": 3, "404": 1 } });
  });
});
