# Chrono24 Node + Vercel Backend

This folder replaces the previous n8n webhook backend with a Node.js API deployed on Vercel.

## API

- Endpoint: `POST /api/chrono24-chat`
- Input JSON:
  - `message` (string, required)
  - `sessionId` (string/number, optional)
- Output JSON:
  - `reply` (string)

## Local development

1. Install dependencies:
   - `npm install`
2. Copy env file:
   - `copy .env.example .env`
3. Fill `OPENAI_API_KEY` in `.env`.
4. Start local server:
   - `npm run dev`

Local API URL will be:
- `http://localhost:3000/api/chrono24-chat`

## Deploy to Vercel

1. From this `Backend` folder:
   - `npx vercel`
2. Add environment variables in Vercel project settings:
   - `OPENAI_API_KEY`
   - Optional: `OPENAI_MODEL`, `MEMORY_TURNS`, `CHRONO24_SYSTEM_PROMPT`
3. After deploy, copy your production URL:
   - `https://<your-project>.vercel.app/api/chrono24-chat`

## Notes

- Session memory is in-memory per deployment instance; this mirrors a lightweight short-term memory and can reset on cold starts/redeployments.
- Reply formatting keeps the same greeting/signoff behavior used in your n8n flow.
