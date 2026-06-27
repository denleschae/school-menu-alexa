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
    intent?: {
      name: string;
      slots?: Record<string, { value?: string }>;
    };
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

// Returns today's date in the given timezone as "YYYY-MM-DD"
function getTodayString(timezone: string): string {
  const now = new Date();
  const local = now.toLocaleDateString("en-US", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }); // "06/27/2026"
  const [month, day, year] = local.split("/");
  return `${year}-${month}-${day}`;
}

// Converts "YYYY-MM-DD" to "M%2FD%2FYYYY" for the SchoolCafe API (no zero-padding on month/day)
function formatServingDate(dateStr: string): string {
  const [year, month, day] = dateStr.split("-");
  return `${parseInt(month!, 10)}%2F${parseInt(day!, 10)}%2F${year}`;
}

// Returns a natural label: "today", "tomorrow", or the weekday name ("Monday")
function getDayLabel(dateStr: string, todayStr: string): string {
  if (dateStr === todayStr) return "today";

  // Compare as UTC noon to avoid DST/timezone shifting the day
  const todayMs = new Date(todayStr + "T12:00:00Z").getTime();
  const dateMs = new Date(dateStr + "T12:00:00Z").getTime();
  const dayDiff = Math.round((dateMs - todayMs) / (1000 * 60 * 60 * 24));

  if (dayDiff === 1) return "tomorrow";

  const [year, month, day] = dateStr.split("-").map(Number);
  const d = new Date(Date.UTC(year!, month! - 1, day!, 12));
  return d.toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" });
}

async function fetchMenu(dateStr: string): Promise<MenuResponse> {
  const servingDate = formatServingDate(dateStr);
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

function buildSpeech(menu: MenuResponse, dayLabel: string): string {
  const entries = Object.entries(menu);
  if (entries.length === 0) {
    return (
      `I couldn't find a lunch menu for ${dayLabel}. ` +
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
      // Strip pricing info like "(A LA CARTE $2.50)" for cleaner speech
      const label = category.replace(/\(.*?\)/g, "").trim();
      const labelLower = label.charAt(0).toLowerCase() + label.slice(1).toLowerCase();
      secondary.push(`the ${labelLower} has ${listItems(items)}`);
    }
  }

  const parts: string[] = [];

  if (primary.length) {
    parts.push(`${dayLabel}'s school lunch main entrées are ${primary.join(" and ")}.`);
  }

  if (secondary.length) {
    const sentence = secondary.join(", and ") + ".";
    parts.push(sentence.charAt(0).toUpperCase() + sentence.slice(1));
  }

  if (!parts.length) {
    return (
      `I couldn't find a lunch menu for ${dayLabel}. ` +
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

  if (
    type === "LaunchRequest" ||
    (type === "IntentRequest" && body.request.intent?.name === "GetLunchMenuIntent")
  ) {
    const timezone = env.TIMEZONE ?? "America/Chicago";
    const todayStr = getTodayString(timezone);

    // Extract date slot from Alexa; fall back to today
    const slotValue = body.request.intent?.slots?.["date"]?.value;

    // AMAZON.DATE can return week ranges ("2026-W26") or months ("2026-06") for
    // vague phrases — we only handle specific dates
    if (slotValue && !/^\d{4}-\d{2}-\d{2}$/.test(slotValue)) {
      return Response.json(
        alexaResponse(
          "I can only look up the menu for a specific day. Try asking for today, tomorrow, or a day like Monday."
        )
      );
    }

    const dateStr = slotValue ?? todayStr;
    const dayLabel = getDayLabel(dateStr, todayStr);

    try {
      const menu = await fetchMenu(dateStr);
      const speech = buildSpeech(menu, dayLabel);
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

async function handleMenuDebug(env: Env, dateStr?: string): Promise<Response> {
  const timezone = env.TIMEZONE ?? "America/Chicago";
  const target = dateStr ?? getTodayString(timezone);
  try {
    const menu = await fetchMenu(target);
    return Response.json({ date: target, menu });
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
      // Optional ?date=YYYY-MM-DD for testing historical dates
      const date = url.searchParams.get("date") ?? undefined;
      return handleMenuDebug(env, date);
    }

    if (request.method === "GET" && url.pathname === "/siri") {
      // Optional ?date=YYYY-MM-DD so Shortcuts can pass tomorrow's date etc.
      const timezone = env.TIMEZONE ?? "America/Chicago";
      const todayStr = getTodayString(timezone);
      const dateParam = url.searchParams.get("date");
      const dateStr =
        dateParam && /^\d{4}-\d{2}-\d{2}$/.test(dateParam) ? dateParam : todayStr;
      const dayLabel = getDayLabel(dateStr, todayStr);
      try {
        const menu = await fetchMenu(dateStr);
        const speech = buildSpeech(menu, dayLabel);
        return new Response(speech, { headers: { "Content-Type": "text/plain" } });
      } catch {
        return new Response(
          "Sorry, I had trouble getting the lunch menu right now.",
          { headers: { "Content-Type": "text/plain" } }
        );
      }
    }

    return new Response("Not Found", { status: 404 });
  },
} satisfies ExportedHandler<Env>;
