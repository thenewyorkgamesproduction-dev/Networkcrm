# Network

A private relationship operating system for capturing context, searching your network, maintaining important relationships, and building better rooms.

## MVP capabilities

- One conversational input for remembering or searching
- Messy shorthand capture in roughly 10 seconds
- Bulk paste, one person per line
- Identity matching by phone, Instagram, email, then unambiguous name
- Raw relationship story preserved as timeline entries
- AI-free keyword and signal search
- Topic strength ranking, such as `really likes Werewolf` above a casual mention
- Copyable name, phone, and Instagram fields
- Follow-up tracking
- Lightweight opportunities
- Person-to-person connections in the backend
- Network Health placeholder for the next release

## Architecture

- `app/` — Next.js web app
- `app/api/crm/route.ts` — server-side proxy that keeps the CRM API key private
- `apps-script/Code.gs` — Google Sheets API and storage layer
- `docs/` — product scope and decisions

## Environment variables

Copy `.env.example` to `.env.local` locally, or add these variables in Vercel:

```text
CRM_APPS_SCRIPT_URL=https://script.google.com/macros/s/.../exec
CRM_API_KEY=your-private-key
APP_PASSWORD=optional-future-password
```

Never commit `.env.local`, the API key, or contact data.

## Apps Script setup

1. Open the CRM Google Sheet.
2. Open **Extensions → Apps Script**.
3. Replace `Code.gs` with `apps-script/Code.gs` from this repository.
4. Run `initializeCrm` once.
5. Run `generateApiKey` if needed.
6. Deploy as a Web App.
7. Add the deployment URL and API key to the web app environment variables.

## Local development

```bash
npm install
npm run dev
```

Open `http://localhost:3000`.

## Production

Import the GitHub repository into Vercel, add the CRM environment variables, and deploy. Ordinary searches do not use an AI API.
