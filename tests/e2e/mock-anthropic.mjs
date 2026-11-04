// A stand-in for the Claude Messages API, used only by the browser tests so
// the real adapter runs end to end without paid calls. Answers by task.
// Also stands in for the Pixabay and Brave image search APIs (E1). Their image
// URLs use a .test host that the browser tests intercept.
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

function photoSearch(url) {
  const query = url.searchParams.get("q") ?? "";
  const slug = encodeURIComponent(query.toLowerCase().replace(/[^a-z]+/g, "-"));
  if (url.pathname === "/api/") {
    if (url.searchParams.get("key") !== "mock-key") return null;
    return {
      total: 1,
      totalHits: 1,
      hits: [
        {
          pageURL: "https://pixabay.com/photos/e2e/",
          user: "Jane Doe",
          tags: query,
          largeImageURL: `https://images.e2e.test/stock/${slug}.jpg`,
          webformatURL: `https://images.e2e.test/stock/${slug}-small.jpg`,
        },
      ],
    };
  }
  if (url.pathname === "/res/v1/images/search") {
    return {
      results: [
        {
          title: `Web photo of ${query}`,
          url: "https://blog.e2e.test/post",
          properties: { url: `https://images.e2e.test/web/${slug}.jpg` },
          thumbnail: { src: `https://images.e2e.test/web/${slug}-small.jpg` },
          meta_url: { hostname: "blog.e2e.test" },
        },
      ],
    };
  }
  return null;
}

createServer((req, res) => {
  if (req.url === "/health") return res.end("ok");
  if (req.method === "GET") {
    const result = photoSearch(new URL(req.url ?? "/", "http://localhost"));
    res.setHeader("content-type", "application/json");
    if (!result) res.statusCode = 404;
    return res.end(JSON.stringify(result ?? { error: "not found" }));
  }
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
