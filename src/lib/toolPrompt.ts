/**
 * Parse model output for JSON tool_request or final_answer.
 * Model may wrap JSON in markdown code blocks; we try to extract.
 * Model may output multiple JSON objects (e.g. two tool_request lines); we parse the FIRST valid one.
 */
export type ParsedToolRequest = {
  type: "tool_request";
  tool_name: string;
  arguments: Record<string, unknown>;
};

export type ParsedFinalAnswer = {
  type: "final_answer";
  content: string;
};

export type ParsedResponse = ParsedToolRequest | ParsedFinalAnswer | null;

function parseOneJsonObject(str: string): ParsedResponse {
  const obj = JSON.parse(str) as { type?: string; tool_name?: string; arguments?: unknown; content?: string };
  if (obj.type === "tool_request" && typeof obj.tool_name === "string") {
    return {
      type: "tool_request",
      tool_name: obj.tool_name,
      arguments: typeof obj.arguments === "object" && obj.arguments !== null ? (obj.arguments as Record<string, unknown>) : {},
    };
  }
  if (obj.type === "final_answer" && typeof obj.content === "string") {
    return { type: "final_answer", content: obj.content };
  }
  return null;
}

/** Extract the first complete {...} from text (balanced braces). */
function extractFirstJsonObject(text: string): string | null {
  const start = text.indexOf("{");
  if (start === -1) return null;
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    if (text[i] === "{") depth++;
    else if (text[i] === "}") {
      depth--;
      if (depth === 0) return text.slice(start, i + 1);
    }
  }
  return null;
}

export function parseToolResponse(raw: string): ParsedResponse {
  const trimmed = raw.trim();
  let jsonStr = trimmed;
  const codeBlock = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (codeBlock) {
    jsonStr = codeBlock[1].trim();
  }
  // Try parsing the whole string first (single JSON object)
  try {
    const out = parseOneJsonObject(jsonStr);
    if (out) return out;
  } catch {
    // not valid JSON
  }
  // Model often outputs multiple JSON objects (one per line). Try first line, then first balanced {...}
  const firstLine = jsonStr.split(/\r?\n/)[0]?.trim();
  if (firstLine?.startsWith("{")) {
    try {
      const out = parseOneJsonObject(firstLine);
      if (out) return out;
    } catch {
      // try extractFirstJsonObject
    }
  }
  const firstObj = extractFirstJsonObject(jsonStr);
  if (firstObj) {
    try {
      const out = parseOneJsonObject(firstObj);
      if (out) return out;
    } catch {
      //
    }
  }
  return null;
}
