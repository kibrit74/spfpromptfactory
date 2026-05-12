# SPF Prompt Factory

"Derdini anlat, model talimatını al."

## Setup

npm install
cp .env.example .env
node server.js

## Google OAuth

Google Cloud Console > APIs & Services > Credentials bölümünde Web application OAuth client oluştur.

Authorized JavaScript origins:
http://localhost:8200

Authorized redirect URIs:
http://localhost:8200/auth/google/callback

`.env.local` içinde şu değerleri doldur:

GOOGLE_CLIENT_ID=
GOOGLE_CLIENT_SECRET=
GOOGLE_CALLBACK_URL=http://localhost:8200/auth/google/callback
APP_URL=http://localhost:8200
SESSION_SECRET=

## Stack

Node.js, Express, Gemini 2.5 Pro, Supabase, Google OAuth
