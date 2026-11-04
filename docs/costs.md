# Running costs

**Short version:** hosting is $0 on Cloudflare's free plan. The only usage cost is Claude, a few cents each time an admin presses an AI button. Visitors never cause AI costs.

**Important:** every Claude figure below is an **estimate**. No real call has been measured yet for AI search or AI help. See "Measure the real cost" at the end.

## Fixed costs

| Item | Cost | Notes |
| --- | --- | --- |
| Cloudflare Workers (free plan) | $0 | 100,000 requests a day; about 10 ms of CPU per request. Pages measured 11–34 ms in production with no failures seen; the owner chose to stay on the free plan and watch for errors (D16) |
| Cloudflare D1 (database) | $0 | Free plan: 5 GB storage, plus daily read and write limits far above personal use |
| Cloudflare R2 (photos) | $0 | Free tier: 10 GB storage, no download fees. R2 may need a payment method on file to turn on |
| Domain `chrisandelissa.com` | Existing renewal | Not part of this project |
| Google sign-in | $0 | |
| Pixabay (stock photos for Find a photo) | $0 | Free API key; optional |
| Brave Search (web photos for Find a photo) | About $5 of free credit a month; card required | Optional. Only used when stock photos find nothing or you ask for more |

Free-plan limits change from time to time; check Cloudflare's pricing pages if usage grows. If a limit is ever hit, the Workers paid plan is about $5 a month (the owner's decision, D16).

## Claude (usage-based)

Model: Claude Opus 5.5 (`claude-opus-5-5`), **$4 per million input tokens and $20 per million output tokens** (thinking counts as output). Web search adds **$10 per 1,000 searches** (1¢ each). Only admins can start these; each one runs only when a button is pressed.

| Feature | When it runs | Estimated cost each |
| --- | --- | --- |
| Link import, page has recipe data | Import → link | Free (no AI) |
| Link import, no recipe data | Import → link | 2–6¢ |
| Paste import (old chat) | Import → paste | 2–5¢ |
| Photo or screenshot import | Import → photo | 2–6¢ |
| Identify ingredients | Editor button | 2–5¢ |
| Check with AI (duplicates) | Button on a duplicate warning | About 1–2¢ |
| Find a photo | Editor or Review button | No Claude cost; Brave search counts against its free credit |
| Preference refresh (about 100 recipes) | Preferences → Refresh | 5–10¢ |
| AI search: **AI** (writes 2–3 recipes) | Search bar, AI on | 5–10¢ |
| AI search: **Web** (up to 3 searches) | Search bar, Web on | 10–20¢ |
| **More ideas** / **More results** | Button under results | About the same as the search again |
| AI help: swaps for a missing ingredient | Recipe page → AI help | 2–5¢ |
| AI help: change this recipe | Recipe page → AI help | 5–10¢ |

**Example month (estimate):** 10 imports, 10 AI searches, 5 Web searches, 5 AI help requests and 1 preference refresh comes to roughly $2–4.

To cap spending, set a monthly spend limit in the Anthropic Console. If the limit is reached, AI buttons show a plain error and everything else keeps working (AC-036).

## Measure the real cost

Two ways, both by the owner:

1. **Anthropic Console → Usage / Cost**: shows cost per day and per model. Try one feature, wait a few minutes, and read the change.
2. **Live smoke test** (estimated under $1 for one run): `ANTHROPIC_API_KEY=sk-ant-... npm run smoke:ai`. It now also runs AI search (AI and More, Web and More) and AI help (swaps and a change), and prints a table of seconds, tokens, web searches and dollars for each. It also checks that every Web link came from the real search.

After either one, replace the estimates in this file with the measured numbers.
