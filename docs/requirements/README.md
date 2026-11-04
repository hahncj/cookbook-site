# Personal recipe and food ideas app

## Purpose

Give recipes created across AI chats one lasting home so the owner can save, find, and use them later. Public visitors can browse; editing and paid AI operations require authorization.

## How to use this package

Start here, then read the linked files. Keep the requirements split by purpose rather than maintaining a second combined copy.

| File | Purpose |
| --- | --- |
| [Product requirements](01-product-requirements.md) | Product context, priorities, confirmed scope, and exclusions |
| [User workflows](02-user-workflows.md) | User journeys and proposed interface behavior |
| [Data and AI integration](03-data-and-ai-integration.md) | Data, access controls, external integrations, and portability |
| [Acceptance criteria](04-acceptance-criteria.md) | Observable checks for implementation and review |
| [Development handoff](05-development-handoff.md) | Build guidance, open decisions, and delivery expectations |
| [Lose It! integration](06-lose-it-integration.md) | Integration research, limitations, and validation plan |
| [Enhancements](07-enhancements.md) | Owner-requested improvements after first release (E1–E4) |

## Latest confirmed decisions

- Primary purpose: store and retrieve the owner's recipes, including recipes currently scattered across AI chats.
- Mobile-friendly, online-only website; anyone can browse without signing in.
- Google sign-in for owner update mode, limited to one or two configured admin accounts that share owner access. AI features and external write integrations require authentication.
- No recipe drafts or separate publishing step. Saved entries are publicly browsable immediately. Pending AI submissions remain outside the catalog until approved.
- Everything readable is public, including notes, feedback markers, history, pasted import text, and preferences. Credentials, settings, inactive records, and pending or rejected submissions stay private.
- Claude powers backend AI. Compatible external AI tools can create and update recipes through an authorized interface. ChatGPT and Claude.ai are the external tools in use.
- External AI submissions require approval by default, with an on/off setting. In-app AI actions the owner starts are approved by the owner's Save.
- Manual entry, pasted chat content (one recipe at a time), links, photo uploads, phone-camera capture, and recipe extraction.
- AI ingredient identification from photos, typed descriptions, or both, for new and existing recipes.
- Search, tags, collections, version history, experiment notes, deletion recovery (inactive records kept indefinitely), and manual backups.
- Serving adjustment, screen-awake cooking mode where supported, personal feedback, and duplicate suggestions without automatic merging.
- AI recommendations from saved recipes and the web, with learned preferences the owner can inspect and correct.
- Lose It! Premium on iPhone. Updated 2026-11-04: Lose It! imports recipes from the public recipe page, so no in-app Lose It! feature is built.
- Functionality comes first, with a rich, distinctive interface.
- Cloudflare free plan at cookbook.chrisandelissa.com, using Cloudflare D1 for the database. Otherwise minimize Cloudflare-specific dependencies.
- Search engines must not index the site.
- Budget does not constrain planning.

Decisions recorded on 2026-11-03 are listed with IDs D1–D16 in the [implementation plan](../implementation-plan.md).

## Requirement status and ownership

**Confirmed** means the owner requested it. **Proposed** means a suggested implementation or default that has not been approved. **Open** means a decision remains unresolved. Technical recommendations do not override confirmed product decisions.

The product requirements file defines scope. Workflows and technical notes elaborate it; acceptance criteria verify it. Update affected files together when a decision changes. If a contradiction remains, resolve it before implementing the affected behavior rather than silently choosing one interpretation.

The stack, Claude model, integration authentication, and deployment arrangement are recorded in the approved [implementation plan](../implementation-plan.md). Metric/US conversion and optional spending limits were discussed as possibilities but have not been requested.

This package and the implementation plan are ready for development. They do not claim that the application or its integrations have been built or tested.
