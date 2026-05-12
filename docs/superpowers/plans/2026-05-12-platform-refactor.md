# SPF Prompt Factory Platform Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Move authenticated product surfaces to React/Vite and split backend logic into TypeScript modules without breaking Google auth, Gemini generation, or Supabase persistence contracts.

**Architecture:** Keep Express as the single backend entrypoint and preserve the existing `/api/*` and `/auth/*` surface. Replace server-rendered `/login`, `/app`, and `/profile` pages with a React SPA mounted behind the same Express server while continuing to serve the existing landing page as static HTML.

**Tech Stack:** Express, TypeScript, tsx, React, Vite, Google OAuth, Supabase, Gemini/Vertex AI

---

### Task 1: Backend Module Split

**Files:**
- Create: `server/index.ts`
- Create: `server/app.ts`
- Create: `server/config/env.ts`
- Create: `server/config/auth.ts`
- Create: `server/config/supabase.ts`
- Create: `server/services/gemini.ts`
- Create: `server/services/prompts.ts`
- Create: `server/routes/api.ts`
- Create: `server/routes/auth.ts`
- Modify: `package.json`

- [ ] Extract env/config creation from `server.js`
- [ ] Move session/passport/Supabase/Gemini logic into focused server modules
- [ ] Keep current API contract for `/api/auth/session`, `/api/auth/config`, `/api/generate`, `/api/prompts`, `/api/prompts/:id`
- [ ] Keep current Google OAuth flow for `/auth/google`, `/auth/google/callback`, `/auth/logout`

### Task 2: React Product Shell

**Files:**
- Create: `src/lib/api.ts`
- Create: `src/lib/types.ts`
- Create: `src/components/AppShell.tsx`
- Create: `src/components/Brand.tsx`
- Create: `src/components/UserMenu.tsx`
- Create: `src/pages/LoginPage.tsx`
- Create: `src/pages/GeneratorPage.tsx`
- Create: `src/pages/ProfilePage.tsx`
- Create: `src/pages/NotFoundPage.tsx`
- Modify: `src/App.tsx`
- Modify: `src/main.tsx`
- Modify: `src/index.css`

- [ ] Build React routes for `/login`, `/app`, `/profile`
- [ ] Port current visual system and authenticated navbar into React components
- [ ] Keep login CTA pointing to `/auth/google`
- [ ] Keep generator workflow and prompt dashboard behavior

### Task 3: Express + Vite Integration

**Files:**
- Modify: `server/app.ts`
- Modify: `vite.config.ts`
- Modify: `package.json`

- [ ] Serve `index.html` for `/`
- [ ] Serve React SPA shell for `/login`, `/app`, `/profile`
- [ ] Keep Express API and auth routes mounted before SPA fallback
- [ ] Support local development through a single `npm run dev` command

### Task 4: Verification

**Files:**
- Modify: `README.md`

- [ ] Run `node --check` equivalent through TypeScript entrypoint validation
- [ ] Run `npm.cmd run lint`
- [ ] Run `npm.cmd run build`
- [ ] Start server and probe `/`, `/login`, `/api/auth/config`, unauthenticated `/api/prompts`
