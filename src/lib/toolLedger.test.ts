import { describe, it, expect } from "vitest";
import {
  createLedger,
  recordInvocation,
  webSearchSucceeded,
  hasFakeWebSearchClaim,
  buildProvenanceFooter,
  CORRECTED_MESSAGE_NO_WEB_SEARCH,
  getWebSourcesFromLedger,
} from "./toolLedger";
import { parseToolResponse } from "./toolPrompt";

describe("hasFakeWebSearchClaim", () => {
  it("detects 'After searching…'", () => {
    expect(hasFakeWebSearchClaim("After searching the web, I found that…")).toBe(true);
  });
  it("detects 'I looked it up'", () => {
    expect(hasFakeWebSearchClaim("I looked it up and the answer is X.")).toBe(true);
  });
  it("detects 'According to my web search'", () => {
    expect(hasFakeWebSearchClaim("According to my web search, the president is…")).toBe(true);
  });
  it("detects 'I found online'", () => {
    expect(hasFakeWebSearchClaim("I found online that this is true.")).toBe(true);
  });
  it("returns false when no claim", () => {
    expect(hasFakeWebSearchClaim("I used my training knowledge.")).toBe(false);
    expect(hasFakeWebSearchClaim("Based on the file you shared…")).toBe(false);
  });
  it("returns false for empty or invalid input", () => {
    expect(hasFakeWebSearchClaim("")).toBe(false);
    expect(hasFakeWebSearchClaim("   ")).toBe(false);
  });
});

describe("webSearchSucceeded", () => {
  it("returns true if web_search was invoked with success", () => {
    const ledger = createLedger(["web_search", "write_file"]);
    recordInvocation(ledger, "web_search", { query: "test" }, "success", "ok", "result");
    expect(webSearchSucceeded(ledger)).toBe(true);
  });
  it("returns false if web_search was not invoked", () => {
    const ledger = createLedger(["web_search", "write_file"]);
    recordInvocation(ledger, "write_file", { path: "a.txt", content: "x" }, "success", "ok", "result");
    expect(webSearchSucceeded(ledger)).toBe(false);
  });
  it("returns false if web_search failed", () => {
    const ledger = createLedger(["web_search"]);
    recordInvocation(ledger, "web_search", { query: "x" }, "error", "failed", "error");
    expect(webSearchSucceeded(ledger)).toBe(false);
  });
});

describe("buildProvenanceFooter", () => {
  it("includes timestamp and tools used", () => {
    const ledger = createLedger(["write_file"]);
    recordInvocation(ledger, "write_file", { path: "a.txt", content: "x" }, "success", "ok", "Wrote 1 bytes");
    const footer = buildProvenanceFooter(ledger);
    expect(footer).toContain("Provenance");
    expect(footer).toContain("Generated at:");
    expect(footer).toContain("write_file");
    expect(footer).toContain("Source URLs:");
    expect(footer).toContain("None (offline)");
  });
  it("includes web sources when web_search succeeded", () => {
    const ledger = createLedger(["web_search", "write_file"]);
    recordInvocation(ledger, "web_search", { query: "x" }, "success", "ok", "Source: https://example.com/1");
    recordInvocation(ledger, "write_file", { path: "a.txt", content: "x" }, "success", "ok", "Wrote 1 bytes");
    const footer = buildProvenanceFooter(ledger);
    expect(footer).toContain("https://example.com/1");
  });
});

describe("CORRECTED_MESSAGE_NO_WEB_SEARCH", () => {
  it("mentions that web search was not performed", () => {
    expect(CORRECTED_MESSAGE_NO_WEB_SEARCH).toContain("did not perform a web search");
    expect(CORRECTED_MESSAGE_NO_WEB_SEARCH).toContain("Web search");
  });
});

describe("getWebSourcesFromLedger", () => {
  it("extracts URLs from web_search output", () => {
    const ledger = createLedger(["web_search"]);
    recordInvocation(
      ledger,
      "web_search",
      { query: "x" },
      "success",
      "ok",
      "Summary: foo\nSource: https://example.com/page"
    );
    const urls = getWebSourcesFromLedger(ledger);
    expect(urls).toContain("https://example.com/page");
  });
});

describe("parseToolResponse (multiple JSON objects)", () => {
  it("parses first tool_request when model outputs two on separate lines", () => {
    const two = '{"type":"tool_request","tool_name":"web_search","arguments":{"query":"current president","max_results":1}}\n{"type":"tool_request","tool_name":"write_file","arguments":{"path":"Desktop/current_president.txt","content":"The current president is [result from web search]."}}';
    const parsed = parseToolResponse(two);
    expect(parsed?.type).toBe("tool_request");
    expect(parsed?.type === "tool_request" && parsed.tool_name).toBe("web_search");
  });
  it("still parses single tool_request", () => {
    const one = '{"type":"tool_request","tool_name":"write_file","arguments":{"path":"a.txt","content":"hi"}}';
    const parsed = parseToolResponse(one);
    expect(parsed?.type).toBe("tool_request");
    expect(parsed?.type === "tool_request" && parsed.tool_name).toBe("write_file");
  });
});
