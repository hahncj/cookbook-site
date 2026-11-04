// A stand-in for the Claude Messages API, used only by the browser tests so
// the real adapter runs end to end without paid calls. Answers by task.
// Also stands in for the Pixabay and Brave image search APIs (E1). Their image
// URLs use a .test host that the browser tests intercept.
import { createServer } from "node:http";

const port = Number(process.env.MOCK_ANTHROPIC_PORT ?? 3102);

function userText(body) {
  const first = body.messages?.[0]?.content;
  return Array.isArray(first) ? first.map((b) => b.text ?? "").join("\n") : String(first ?? "");
}

function between(text, open, close) {
  const start = text.indexOf(open);
  if (start < 0) return "";
  const end = text.indexOf(close, start + open.length);
  return text.slice(start + open.length, end < 0 ? undefined : end).trim();
}

/** M7 preference profile: two real patterns, plus one the app must drop (no medical inferences). */
function profile(body) {
  const cookbook = JSON.parse(between(userText(body), "<cookbook>", "</cookbook>") || "[]");
  const korean = cookbook.find((r) => /gochujang|noodle/i.test(JSON.stringify(r))) ?? cookbook[0];
  const hearty = cookbook.find((r) => /chili|stew|bean/i.test(JSON.stringify(r))) ?? cookbook[1] ?? cookbook[0];
  return {
    preferences: [
      { statement: "Likes spicy Korean flavors such as gochujang", confidence: "medium", evidence: korean ? [korean.id] : [] },
      { statement: "Enjoys hearty one-pot meals", confidence: "low", evidence: hearty ? [hearty.id] : [] },
      { statement: "Has a peanut allergy", confidence: "low", evidence: korean ? [korean.id] : [] },
      { statement: "Loves invented dishes", confidence: "low", evidence: ["no-such-recipe"] },
    ],
    note: "A small sample, so these are guesses.",
  };
}

/**
 * M7 "Web". It pauses once (pause_turn) to exercise the resume loop, returns
 * search results (no page reads), and then submits one real web page and one
 * made-up link the app must drop (AC-034). "More" gets a different page.
 */
function discover(body) {
  const text = userText(body);
  const request = between(text, "<request>", "</request>");
  // "More": once the eggplant page has been shown, offer a different page.
  const more = text.includes("Already shown for this request") && text.includes("miso-eggplant");
  const page = more
    ? { title: "Pumpkin Lentil Soup", url: "https://recipes.e2e.test/pumpkin-soup", source_name: "E2E Recipes", reason: "Another warming option." }
    : { title: "Miso Glazed Eggplant", url: "https://recipes.e2e.test/miso-eggplant", source_name: "E2E Recipes", reason: "Something new with similar flavors." };
  const submit = {
    type: "tool_use",
    id: "toolu_submit",
    name: "submit_suggestions",
    input: {
      web: [page, { title: "Imaginary Pie", url: "https://invented.e2e.test/pie", source_name: "Nowhere", reason: "Made up." }],
      note: "",
    },
  };
  const search = (id, results) => [
    { type: "server_tool_use", id, name: "web_search", input: { query: request } },
    {
      type: "web_search_tool_result",
      tool_use_id: id,
      content: results.map((r) => ({ type: "web_search_result", url: r.url, title: r.title, encrypted_content: "x", page_age: null })),
    },
  ];
  if ((body.messages ?? []).length === 1) return { content: search("srvtoolu_1", [{ url: "https://recipes.e2e.test/other", title: "Other" }]), stop_reason: "pause_turn" };
  return { content: [...search("srvtoolu_2", [page]), { type: "text", text: "Here are my picks." }, submit], stop_reason: "tool_use" };
}

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
  if (system.includes("study a family cookbook")) return profile(body);
  if (system.includes("You write NEW recipes")) {
    const text = userText(body);
    const request = between(text, "<request>", "</request>");
    const confirmed = between(text, "Preference profile:", "\n\n")
      .split("\n")
      .filter((line) => line.includes("(confirmed by the owner)"))
      .map((line) => line.replace(/^- /, "").replace(" (confirmed by the owner)", ""));
    return {
      recipes: [
        {
          title: `AI ${request.replace(/\b\w/g, (c) => c.toUpperCase())} ${text.includes("Already shown for this request") ? "Soup" : "Bowl"}`,
          description: "A quick bowl built around your request.",
          servings: "Serves 2",
          prep_time: "10 min",
          cook_time: "15 min",
          ingredients: [
            { quantity: "200 g", item: "rice noodles" },
            { quantity: "1 tbsp", item: "soy sauce" },
          ],
          steps: ["Soak the noodles.", "Toss with the sauce."],
          notes: "",
          reason: [`Fits “${request}”.`, confirmed[0] ? `Matches your preference: ${confirmed[0]}.` : ""].filter(Boolean).join(" "),
        },
      ],
      note: "",
    };
  }
  if (system.includes("missing an ingredient")) {
    const missing = userText(body).match(/Missing ingredient: (.+)/)?.[1] ?? "it";
    return {
      options: [
        { use: "plain Greek yogurt", amount: "same amount", how: "Stir it in off the heat.", effect: `A little tangier than ${missing}.` },
        { use: "sour cream", amount: "same amount", how: "", effect: "Richer." },
      ],
      message: "",
    };
  }
  if (system.includes("adapt a home cook")) {
    const recipe = between(userText(body), "<recipe>", "</recipe>");
    const request = between(userText(body), "<request>", "</request>");
    const title = recipe.match(/^Title: (.+)$/m)?.[1] ?? "Recipe";
    const lines = recipe.split("\n");
    const ingredients = lines
      .slice(lines.indexOf("Ingredients:") + 1, lines.indexOf("Steps:"))
      .map((line) => line.replace(/^- /, ""))
      .map((line, n) => (n === 0 ? { quantity: "1 can", item: "lentils" } : { quantity: "", item: line }));
    const first = lines[lines.indexOf("Ingredients:") + 1]?.replace(/^- /, "") ?? "the first ingredient";
    return {
      recipe: {
        title: `${title} (${request})`,
        description: "",
        servings: recipe.match(/^Servings: (.+)$/m)?.[1] ?? "",
        prep_time: "",
        cook_time: "",
        ingredients,
        steps: lines.filter((line) => /^\d+\. /.test(line)).map((line) => line.replace(/^\d+\. /, "")),
        notes: "",
      },
      changes: [`Swapped ${first} for 1 can of lentils`],
      message: "",
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
    const system = String(body.system ?? "");
    const special = system.includes("find NEW recipes") ? discover(body) : null;
    if (special) {
      return res.end(
        JSON.stringify({
          id: `msg_mock_${Date.now()}`,
          type: "message",
          role: "assistant",
          model: body.model,
          content: special.content,
          stop_reason: special.stop_reason,
          stop_sequence: null,
          usage: { input_tokens: 10, output_tokens: 10 },
        }),
      );
    }
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
