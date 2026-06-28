# School Lunch — Alexa & Siri Skill

A voice skill that answers "What's for lunch at school today?" by fetching the day's menu from the SchoolCafe API and reading it aloud. Works with both Alexa and Siri. Runs entirely on a Cloudflare Worker — no AWS Lambda, no database.

> "Alexa, ask school lunch what's for lunch today."
> "Hey Siri, school lunch tomorrow."

## How It Works

```
Alexa Device
    ↓  voice request
Alexa Skill (ASK Console)
    ↓  POST /alexa
Cloudflare Worker  (this repo)
    ↓  GET
SchoolCafe API
    ↓  JSON menu
Cloudflare Worker  (formats speech)
    ↓  Alexa response
Alexa Device speaks the menu
```

## Prerequisites

- [Cloudflare account](https://dash.cloudflare.com/sign-up) (free tier is fine)
- [Amazon Developer account](https://developer.amazon.com/) for the Alexa skill (optional)
- Apple device with the Shortcuts app for Siri integration (optional)
- [pnpm](https://pnpm.io/installation)

## Setup

### 1. Install dependencies

```bash
pnpm install
```

### 2. Configure your school

Open `src/index.ts` and update the `CONFIG` block at the top:

```ts
const CONFIG = {
  SCHOOL_ID: "your-school-uuid-here", // find this via the SchoolCafe API
  // ...
};
```

Also update `TIMEZONE` in `wrangler.jsonc` to match your school's local timezone:

```jsonc
"vars": {
  "TIMEZONE": "America/Chicago"
}
```

To find your school's UUID, visit [schoolcafe.com](https://www.schoolcafe.com), navigate to your school's menu, and inspect the network request to `webapis.schoolcafe.com`.

### 3. Deploy to Cloudflare

```bash
pnpm exec wrangler login   # one-time browser auth
pnpm run deploy
```

Note your Worker URL — it will look like:
`https://school-menu-alexa.<your-subdomain>.workers.dev`

### 4. Test the menu endpoint

Before touching Alexa, verify the Worker is fetching menus correctly:

```bash
curl https://school-menu-alexa.<your-subdomain>.workers.dev/menu
```

You should see a JSON object with today's menu categories and items.

### 5. Set up Siri (optional)

The `/siri` endpoint returns plain text for use with Apple Shortcuts. Create shortcuts in the **Shortcuts app** on iPhone/iPad and they'll sync to HomePods via iCloud.

**"School Lunch" (today):**
1. Add Action → **Get Contents of URL**: `https://<your-worker>.workers.dev/siri`
2. Add Action → **Speak Text** → select the URL result
3. Name the shortcut **School Lunch**

**"School Lunch Tomorrow":**
1. Add Action → **Date** → set to **Tomorrow**
2. Add Action → **Format Date** → Custom format: `yyyy-MM-dd`
3. Add Action → **Get Contents of URL**: `https://<your-worker>.workers.dev/siri?date=` + the formatted date
4. Add Action → **Speak Text** → select the URL result
5. Name the shortcut **School Lunch Tomorrow**

Repeat the tomorrow pattern for day-of-week shortcuts ("School Lunch Monday", etc.) using **Adjust Date** set to the next occurrence of each weekday.

**HomePod access:** Shortcuts sync automatically to HomePods on the same Apple ID. If your kids have separate Apple IDs, share the shortcut via iCloud link (tap **···** → **Share**) so they can add it to their own library.

### 6. Create the Alexa skill

1. Go to the [Alexa Developer Console](https://developer.amazon.com/alexa/console/ask) and create a **Custom Skill**
2. Set the **invocation name** to `school lunch`
3. Create an intent named `GetLunchMenuIntent` with an `AMAZON.DATE` slot named `date`, and sample utterances:
   - _what's for lunch {date}_
   - _what's for lunch at school {date}_
   - _what's on the lunch menu {date}_
   - _what are they serving {date}_
   - _what's for lunch today_
   - _what's for lunch tomorrow_
   - _what's for lunch at school_
   - _what's the school lunch_
4. Under **Endpoint**, select **HTTPS** and enter your Worker URL + `/alexa`:
   ```
   https://school-menu-alexa.<your-subdomain>.workers.dev/alexa
   ```
   Set the SSL certificate type to **"My development endpoint is a sub-domain of a domain that has a wildcard certificate from a certificate authority"**
5. Save and build the model
6. Enable the skill on your household's Amazon account via the **Dev** tab in the Alexa app

## Local Development

```bash
pnpm run dev
```

Test the debug endpoint (today's menu as JSON):

```bash
curl http://localhost:8787/menu

# Historical date
curl "http://localhost:8787/menu?date=2026-06-08"
```

Test the Siri endpoint (today's menu as plain text):

```bash
curl http://localhost:8787/siri

# Specific date
curl "http://localhost:8787/siri?date=2026-06-08"
```

Test a simulated Alexa request:

```bash
curl -X POST http://localhost:8787/alexa \
  -H "Content-Type: application/json" \
  -d '{"version":"1.0","request":{"type":"IntentRequest","intent":{"name":"GetLunchMenuIntent","slots":{"date":{"value":"2026-06-08"}}}}}'
```

## Endpoints

| Method | Path | Description |
|--------|------|-------------|
| `POST` | `/alexa` | Alexa skill handler — accepts signed Alexa JSON requests |
| `GET` | `/siri` | Siri Shortcuts — returns plain text menu, accepts `?date=YYYY-MM-DD` |
| `GET` | `/menu` | Debug — returns raw JSON from SchoolCafe, accepts `?date=YYYY-MM-DD` |

## Project Structure

```
src/
└── index.ts       # Worker — fetching, parsing, Alexa and Siri responses
wrangler.jsonc     # Cloudflare Worker config
tsconfig.json
package.json
```

## Notes

- **No menu today?** The SchoolCafe API returns an empty object `{}` on weekends and holidays. The skill responds with a friendly "no school today" message.
- **Timezone:** The Worker runs in UTC. The `TIMEZONE` var ensures "today" is always calculated in your school's local time.
- **Request verification:** Alexa signature verification is not implemented. For a private household skill this is low risk, but see the [ASK docs](https://developer.amazon.com/en-US/docs/alexa/custom-skills/host-a-custom-skill-as-a-web-service.html#verify-request-sent-by-alexa) if you want to add it.

## License

MIT
