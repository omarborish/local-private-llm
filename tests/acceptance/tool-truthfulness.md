# Acceptance tests: Tool truthfulness and provenance

These scenarios must hold when testing the app manually or in E2E.

## A) Web search disabled

**Setup:** Settings → MCP Tools: disable "Web search". Leave Filesystem or other tools enabled if desired.

**User action:** Send a message such as: "Search the web for the current president and write the result to Desktop/president.txt"

**Expected:**

1. **Assistant response** must NOT claim it performed a web search (e.g. no "After searching…", "I looked it up…", "According to my web search…").
2. If the model outputs such a claim, the app **blocks** that response and shows the corrected message: "I did not perform a web search. Web search is either not enabled…"
3. If the model requests `write_file` with content that claims web search was used:
   - The written file must include a note that web search was not performed (prepended or in provenance).
   - The file must **not** assert the current president as fact from "search"; it should state that web search was not available or offer offline alternatives.
4. Every written file must include a **Provenance** footer with:
   - Generated at: (timestamp)
   - Tools used: (list)
   - Web sources: None (offline)
   - Notes: This assistant cannot browse the internet unless the web_search tool is enabled and was used.

## B) Web search enabled and configured

**Setup:** Settings → MCP Tools: enable "Web search". Ensure the app can reach the search provider (DuckDuckGo).

**User action:** Send a message such as: "Search the web for the current weather in Paris and save a short summary to Desktop/weather.txt"

**Expected:**

1. The assistant must **call** the `web_search` tool (visible in tool-used toast / conversation as a tool result).
2. The assistant must **not** write "After searching…" or similar unless the `web_search` tool was actually invoked and succeeded (enforced by the ledger).
3. The written file must include **sources** (URLs) in the Provenance section when web_search was used.
4. Provenance footer must list `web_search` under "Tools used" and list web source URLs under "Web sources".

---

**Running unit tests (validator, ledger, provenance):**

```bash
npm run test
```

This runs `src/lib/toolLedger.test.ts` (hasFakeWebSearchClaim, webSearchSucceeded, buildProvenanceFooter).
