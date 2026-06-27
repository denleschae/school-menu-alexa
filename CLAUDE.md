# School Lunch Alexa Skill — Cloudflare Worker

## Project Overview

An Alexa skill that responds to "What's for lunch at school?" by fetching the
day's lunch menu from the SchoolCafe API and reading it aloud. Built as a
Cloudflare Worker with no AWS dependencies.

---

## Architecture

```
Alexa Device
    ↓  "What's for lunch at school?"
Alexa Skill (ASK Console)
    ↓  POST /alexa  (signed JSON request)
Cloudflare Worker  (this project)
    ↓  GET
SchoolCafe API (webapis.schoolcafe.com)
    ↓  JSON response
Cloudflare Worker  (parses + formats)
    ↓  Alexa JSON response
Alexa Device speaks the menu
```

---

## Tech Stack

| Layer                    | Tool                                             |
| ------------------------ | ------------------------------------------------ |
| Voice interface          | Amazon Alexa Custom Skill (ASK)                  |
| Backend / API handler    | Cloudflare Worker (TypeScript)                   |
| Package manager / deploy | Wrangler CLI                                     |
| Testing                  | Wrangler dev + Alexa Developer Console simulator |

No S3, Lambda, or DynamoDB. No PDF parsing. No database needed — the
SchoolCafe API is the source of truth, fetched live on each request.

---

## Project Structure

```
school-lunch-skill/
├── src/
│   └── index.ts          # Main Worker entry point
├── wrangler.toml          # Cloudflare Worker config
├── package.json
├── tsconfig.json
└── CLAUDE.md              # This file
```

---

## SchoolCafe API

### Endpoint

```
GET https://webapis.schoolcafe.com/api/CalendarView/GetDailyMenuitems
```

### Query Parameters

| Parameter     | Value                                  | Notes                  |
| ------------- | -------------------------------------- | ---------------------- |
| `SchoolId`    | `d74d705e-3078-4073-b74b-adcb07592eeb` | School's UUID          |
| `ServingDate` | `06%2F27%2F2026`                       | URL-encoded MM/DD/YYYY |
| `ServingLine` | `Lunch`                                |                        |
| `MealType`    | `Lunch`                                |                        |

### Example curl

```bash
curl "https://webapis.schoolcafe.com/api/CalendarView/GetDailyMenuitems?SchoolId=d74d705e-3078-4073-b74b-adcb07592eeb&ServingDate=06%2F27%2F2026&ServingLine=Lunch&MealType=Lunch"
```

### Response Shape

The response is a JSON **object** where each **key is a category name** and
each **value is an array of menu items**. Example:

```json
{
  "MAIN ENTREE (A LA CARTE $2.50)": [
    {
      "MenuItemDescription": "Cheese Pizza",
      "Calories": 280,
      "Allergens": "Milk,Wheat,Soy,Gluten",
      "AllergenDisplay": "Contains Gluten, Milk, Soy, Wheat.",
      "Category": "MAIN ENTREE (A LA CARTE $2.50)",
      "ServingLine": "Lunch",
      "DefaultServingSize": "1 ea.",
      "SubIngredientsDisplay": "Individual Cheese Pizza",
      "ThumbnailImageURL": "https://..."
    }
  ],
  "GARDEN BAR OFFERINGS": [ ... ],
  "MILK CHOICE (A LA CARTE $0.50)": [ ... ]
}
```

### Key Fields Per Item

| Field                 | Type           | Use                                           |
| --------------------- | -------------- | --------------------------------------------- |
| `MenuItemDescription` | string         | ✅ Primary — item name to speak               |
| `Category`            | string         | ✅ Used to group items in speech              |
| `Calories`            | number         | Optional — include in response if desired     |
| `AllergenDisplay`     | string \| null | Optional — useful for allergy-aware responses |
| `Allergens`           | string         | Comma-separated allergen list                 |
| `DefaultServingSize`  | string         | Optional                                      |

### Date Formatting for ServingDate

The API expects `MM/DD/YYYY`, URL-encoded as `MM%2FDD%2FYYYY`.

```typescript
function getServingDate(date: Date, timeZone: string): string {
  // Returns "06%2F27%2F2026"
  const local = date.toLocaleDateString("en-US", {
    timeZone,
    month: "2-digit",
    day: "2-digit",
    year: "numeric",
  }); // "06/27/2026"
  return local.replace(/\//g, "%2F");
}
```

---

## Worker Endpoints

### `POST /alexa`

Handles all Alexa skill requests. Alexa sends a signed JSON body.

**Supported request types:**

- `LaunchRequest` — user opens the skill without a specific utterance
- `IntentRequest` with intent name `GetLunchMenuIntent`
- `SessionEndedRequest` — graceful close

**Response:** Alexa JSON envelope with `outputSpeech.text` set to the
formatted menu string.

### `GET /menu` (debug)

Returns raw JSON from the SchoolCafe API for the current day. Use this
during development to inspect the live response without going through Alexa.

---

## Alexa Skill Configuration (ASK Console)

### Skill Type

Custom Skill

### Invocation Name

`school lunch` → "Alexa, ask school lunch what's for lunch today"

### Intent: `GetLunchMenuIntent`

Sample utterances:

- what's for lunch at school
- what's for lunch today
- what's the school lunch
- what are they serving today
- what's on the lunch menu

### Endpoint

Set to your deployed Worker URL:

```
https://school-lunch.<your-subdomain>.workers.dev/alexa
```

### Account Linking

None required.

### Distribution

Set to **private** (not published to Alexa store). Enable only on your
household's Amazon account under "Beta Test" or skill enablement.

---

## Speech Output Format

The Worker should build a natural-sounding response. Focus on **main entrees**
only for brevity — kids don't need Alexa to list every garden bar item.

**Target output:**

> "Today's school lunch main entrées are Cheese Pizza and Chicken Tenders.
> The garden bar has Celery Sticks, Garbanzo Beans, Romaine Lettuce with
> Italian Dressing, Strawberries, and Strawberry Applesauce Cups."

**No school / empty menu:**

> "I couldn't find a lunch menu for today. It might be a holiday or a
> no-school day."

**API error:**

> "Sorry, I had trouble getting the lunch menu right now. Please try again
> in a moment."

---

## Configuration Constants

Define these at the top of `src/index.ts`:

```typescript
const CONFIG = {
  SCHOOL_ID: "d74d705e-3078-4073-b74b-adcb07592eeb",
  SERVING_LINE: "Lunch",
  MEAL_TYPE: "Lunch",
  TIMEZONE: "America/Chicago", // ← Set to your local timezone
  SCHOOLCAFE_BASE_URL: "https://webapis.schoolcafe.com",
  // Categories to include in the main speech (in order)
  PRIMARY_CATEGORIES: ["MAIN ENTREE"], // partial match on category key
};
```

---

## wrangler.toml

```toml
name = "school-lunch-skill"
main = "src/index.ts"
compatibility_date = "2025-01-01"

[vars]
TIMEZONE = "America/Chicago"
```

Secrets (if you ever need to lock down the `/alexa` endpoint with a shared
secret) should be added via:

```bash
wrangler secret put ALEXA_SKILL_ID
```

---

## Development Workflow

### Install & run locally

```bash
npm create cloudflare@latest school-lunch-skill -- --type worker
cd school-lunch-skill
wrangler dev
```

### Test the debug endpoint

```bash
curl http://localhost:8787/menu
```

### Test the Alexa endpoint locally

```bash
curl -X POST http://localhost:8787/alexa \
  -H "Content-Type: application/json" \
  -d '{
    "version": "1.0",
    "request": {
      "type": "IntentRequest",
      "intent": { "name": "GetLunchMenuIntent" }
    }
  }'
```

### Deploy

```bash
wrangler deploy
```

---

## Implementation Notes

1. **No Alexa request signature verification** is implemented initially —
   add it once the skill is working. For a private household skill the risk
   is minimal, but see the ASK docs for `SignatureCertChainUrl` verification
   if desired.

2. **The API is unauthenticated** — no API key or login needed. Just the
   SchoolId UUID in the query string.

3. **Weekends / holidays** — the API returns an empty object `{}` when there
   is no menu. Handle this gracefully.

4. **Timezone matters** — the Worker runs in UTC. Always derive "today's
   date" using the school's local timezone, not `new Date().toISOString()`.

5. **Category matching** — category names include pricing info
   (e.g. `"MAIN ENTREE (A LA CARTE $2.50)"`). Use `includes()` or
   `startsWith()` rather than exact string matching when filtering categories.
