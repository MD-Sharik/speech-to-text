# Speech to Text

Real-time speech to text (Hindi, English or mixed) using Gemini Live API. Transcripts are saved in PostgreSQL and shown in a history dashboard with create, read, update, delete and search. Each saved transcript can be played back with browser text-to-speech.

## Stack

- Node.js, Express, WebSocket (`ws`)
- PostgreSQL (`pg`)
- Gemini Live API (`@google/genai`), model `gemini-3.1-flash-live-preview`
- Plain HTML, CSS, JS

## How it works

1. Browser captures mic audio, converts it to 16 kHz 16-bit PCM in an AudioWorklet and streams it to the server over WebSocket.
2. Server forwards audio to Gemini Live with input audio transcription turned on.
3. Transcription text comes back in real time and is pushed to the browser.
4. User can edit, copy and save it. Saved transcripts are listed in History.

Note: the server sets the Gemini API version to `v1beta`. With the SDK default (`v1`) the Live connection fails with a 404.

## Run locally

```bash
npm install
cp .env.example .env
npm start
```

Fill `GEMINI_API_KEY` (get one free from Google AI Studio) and `DATABASE_URL` in `.env`. Table is created automatically on start. Open http://localhost:3000

## API

| Method | Route | Body |
|---|---|---|
| GET | /api/transcripts?q= | |
| GET | /api/transcripts/:id | |
| POST | /api/transcripts | `{ "text": "..." }` |
| PUT | /api/transcripts/:id | `{ "text": "..." }` |
| DELETE | /api/transcripts/:id | |

WebSocket: `/live` (binary PCM in, JSON transcription out)

## Deploy (Vercel + Neon)

1. Create a Postgres database on Neon and copy the pooled connection string (the host contains `-pooler`). Change `sslmode=require` to `sslmode=verify-full`.
2. On Vercel, import this repo as a new project.
3. Add env vars: `GEMINI_API_KEY`, `GEMINI_MODEL`, `DATABASE_URL`, `DB_SSL=true`.
4. Deploy. The table is created automatically on start.

Notes:

- Live transcription uses WebSockets, which are in public beta on Vercel and need Fluid compute (on by default for new projects).
- A live session ends when the function reaches its max duration (300 seconds by default, which is also the Hobby plan limit). Press Start to continue.
- The app has no login. Anyone with the URL can read, edit and delete transcripts and use your Gemini quota.
