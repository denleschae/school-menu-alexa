const CONFIG = {
  SCHOOL_ID: "d74d705e-3078-4073-b74b-adcb07592eeb",
  SERVING_LINE: "Lunch",
  MEAL_TYPE: "Lunch",
  SCHOOLCAFE_BASE_URL: "https://webapis.schoolcafe.com",
  // Category keys that contain the main entrees to highlight first
  PRIMARY_CATEGORY_KEYWORDS: ["MAIN ENTREE"],
  // Category keys to skip entirely (they add noise to the speech)
  SKIP_CATEGORY_KEYWORDS: ["MILK"],
};

interface Env {
  TIMEZONE: string;
}

// SchoolCafe API types
interface MenuItem {
  MenuItemDescription: string;
  Category: string;
  Calories?: number;
  AllergenDisplay?: string | null;
}

type MenuResponse = Record<string, MenuItem[]>;

// Alexa request/response types (minimal, only what we need)
interface AlexaRequest {
  version: string;
  request: {
    type: string;
    intent?: { name: string };
  };
}

interface AlexaSpeechResponse {
  version: string;
  response: {
    outputSpeech: { type: "PlainText"; text: string };
    shouldEndSession: boolean;
  };
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function getServingDate(date: Date, timeZone: string): string {
  const local = date.toLocaleDateString("en-US", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }); // "06/27/2026"
  return local.replace(/\//g, "%2F");
}

async function fetchMenu(date: Date, timezone: string): Promise<MenuResponse> {
  const servingDate = getServingDate(date, timezone);
  const url =
    `${CONFIG.SCHOOLCAFE_BASE_URL}/api/CalendarView/GetDailyMenuitems` +
    `?SchoolId=${CONFIG.SCHOOL_ID}` +
    `&ServingDate=${servingDate}` +
    `&ServingLine=${CONFIG.SERVING_LINE}` +
    `&MealType=${CONFIG.MEAL_TYPE}`;

  const res = await fetch(url);
  if (!res.ok) throw new Error(`SchoolCafe API returned ${res.status}`);
  return res.json() as Promise<MenuResponse>;
}

function categoryMatches(category: string, keywords: string[]): boolean {
  const upper = category.toUpperCase();
  return keywords.some((kw) => upper.includes(kw));
}

function listItems(items: MenuItem[]): string {
  return items.map((i) => i.MenuItemDescription).join(", ");
}

function buildSpeech(menu: MenuResponse, dayName: string): string {
  const entries = Object.entries(menu);
  if (entries.length === 0) {
    return (
      `I couldn't find a lunch menu for ${dayName}. ` +
      "It might be a holiday or a no-school day."
    );
  }

  const primary: string[] = [];
  const secondary: string[] = [];

  for (const [category, items] of entries) {
    if (!items.length) continue;
    if (categoryMatches(category, CONFIG.SKIP_CATEGORY_KEYWORDS)) continue;

    if (categoryMatches(category, CONFIG.PRIMARY_CATEGORY_KEYWORDS)) {
      primary.push(listItems(items));
    } else {
      // Use a friendlier label: strip pricing info like "(A LA CARTE $2.50)"
      const label = category.replace(/\(.*?\)/g, "").trim().toLowerCase();
      secondary.push(`the ${label} has ${listItems(items)}`);
    }
  }

  const parts: string[] = [];

  if (primary.length) {
    parts.push(`${dayName}'s school lunch main entrées are ${primary.join(" and ")}.`);
  }

  if (secondary.length) {
    parts.push(secondary.join(", and ") + ".");
  }

  if (!parts.length) {
    return (
      `I couldn't find a lunch menu for ${dayName}. ` +
      "It might be a holiday or a no-school day."
    );
  }

  return parts.join(" ");
}

function alexaResponse(text: string): AlexaSpeechResponse {
  return {
    version: "1.0",
    response: {
      outputSpeech: { type: "PlainText", text },
      shouldEndSession: true,
    },
  };
}

// ─── Request Handlers ────────────────────────────────────────────────────────

async function handleAlexaRequest(req: Request, env: Env): Promise<Response> {
  let body: AlexaRequest;
  try {
    body = await req.json();
  } catch {
    return new Response("Bad Request", { status: 400 });
  }

  const type = body.request?.type;

  if (type === "SessionEndedRequest") {
    return Response.json(alexaResponse("Goodbye!"));
  }

  if (type === "LaunchRequest" || (type === "IntentRequest" && body.request.intent?.name === "GetLunchMenuIntent")) {
    const now = new Date();
    const timezone = env.TIMEZONE ?? "America/Chicago";
    const dayName = now.toLocaleDateString("en-US", {
      timeZone: timezone,
      weekday: "long",
    });

    try {
      const menu = await fetchMenu(now, timezone);
      const speech = buildSpeech(menu, dayName);
      return Response.json(alexaResponse(speech));
    } catch {
      return Response.json(
        alexaResponse(
          "Sorry, I had trouble getting the lunch menu right now. Please try again in a moment."
        )
      );
    }
  }

  return Response.json(
    alexaResponse("I'm not sure how to help with that. Try asking what's for lunch today.")
  );
}

async function handleMenuDebug(env: Env): Promise<Response> {
  const now = new Date();
  const timezone = env.TIMEZONE ?? "America/Chicago";
  try {
    const menu = await fetchMenu(now, timezone);
    return Response.json(menu);
  } catch (err) {
    return Response.json({ error: String(err) }, { status: 502 });
  }
}

// ─── Entry Point ─────────────────────────────────────────────────────────────

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === "/alexa") {
      return handleAlexaRequest(request, env);
    }

    if (request.method === "GET" && url.pathname === "/menu") {
      return handleMenuDebug(env);
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
