// A stand-in for the Claude Messages API, used only by the browser tests so
// the real adapter runs end to end without paid calls. Answers by task.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 3102);

function answer(body) {
  const system = String(body.system ?? "");
  const text = JSON.stringify(body.messages ?? []);
  const hasImage = text.includes('"type":"image"');
  if (system.includes("copy recipes")) {
    if (text.includes("NO RECIPE HERE")) return { found: false, kind: "recipe", title: "", description: "", servings: "", prepTime: "", cookTime: "", ingredients: [], steps: [], notes: "", sourceName: "", uncertain: [], otherRecipes: 0 };
    const title = text.match(/Title: ([^\\"]+)/)?.[1] ?? (hasImage ? "Photo Card Cookies" : "Imported Recipe");
    return {
      found: true,
      kind: "recipe",
      title,
      description: "",
      servings: "Serves 4",
      prepTime: "",
      cookTime: "",
      ingredients: [
        { quantity: "2 cups", item: "flour" },
        { quantity: "", item: "a pinch of salt" },
      ],
      steps: ["Mix everything.", "Bake until golden."],
      notes: "",
      sourceName: "Old chat",
      uncertain: ["Oven temperature wasn't given"],
      otherRecipes: text.includes("SECOND RECIPE") ? 1 : 0,
    };
  }
  if (system.includes("list the ingredients")) {
    return {
      suggestions: [
        { name: "green onions", confidence: "high", note: "" },
        { name: "sesame seeds", confidence: "low", note: "Could be breadcrumbs" },
      ],
      message: "",
    };
  }
  return { verdict: "variation", explanation: "Same base dish with different seasoning." };
}

createServer((req, res) => {
  if (req.url === "/health") return res.end("ok");
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    res.setHeader("content-type", "application/json");
    res.end(
      JSON.stringify({
        id: `msg_mock_${Date.now()}`,
        type: "message",
        role: "assistant",
        model: body.model,
        content: [{ type: "text", text: JSON.stringify(answer(body)) }],
        stop_reason: "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 10, output_tokens: 10 },
      }),
    );
  });
}).listen(port);
