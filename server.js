import fs from 'node:fs';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const app = express();
const port = Number(process.env.PORT || 8200);

app.set('trust proxy', 1);
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'spf-prompt-factory-local-session-secret',
    resave: false,
    saveUninitialized: false,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: process.env.NODE_ENV === 'production',
      maxAge: 1000 * 60 * 60 * 24 * 7,
    },
  }),
);
app.use(passport.initialize());
app.use(passport.session());

app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
  res.status(204).end();
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
const supabaseConfigured = Boolean(supabaseUrl && supabaseAnonKey);
const supabase = supabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;
const supabaseAdmin =
  supabaseUrl && (supabaseServiceKey || supabaseAnonKey)
    ? createClient(supabaseUrl, supabaseServiceKey || supabaseAnonKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      })
    : null;

const googleOAuthConfigured = Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
const defaultAppUrl = process.env.APP_URL || `http://localhost:${port}`;
const configuredGoogleCallbackUrl =
  process.env.GOOGLE_CALLBACK_URL || `${normalizeBaseUrl(defaultAppUrl)}/auth/google/callback`;

function normalizeBaseUrl(value) {
  return String(value || `http://localhost:${port}`).replace(/\/+$/, '');
}

function getRequestBaseUrl(req) {
  const forwardedProto = req.get('x-forwarded-proto')?.split(',')[0]?.trim();
  const forwardedHost = req.get('x-forwarded-host')?.split(',')[0]?.trim();
  const protocol = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host') || `localhost:${port}`;
  return normalizeBaseUrl(`${protocol}://${host}`);
}

function getGoogleCallbackUrl(req) {
  if (process.env.GOOGLE_CALLBACK_URL) return process.env.GOOGLE_CALLBACK_URL;
  if (process.env.APP_URL) return `${normalizeBaseUrl(process.env.APP_URL)}/auth/google/callback`;
  return `${getRequestBaseUrl(req)}/auth/google/callback`;
}

function logOAuthError(error) {
  const rawData =
    typeof error?.data === 'string'
      ? error.data
      : typeof error?.oauthError?.data === 'string'
        ? error.oauthError.data
        : '';

  let details = rawData;
  if (rawData) {
    try {
      details = JSON.stringify(JSON.parse(rawData));
    } catch {
      details = rawData;
    }
  }

  console.error('Google OAuth callback failed:', {
    name: error?.name,
    message: error?.message,
    statusCode: error?.statusCode || error?.oauthError?.statusCode,
    details,
  });
}

passport.serializeUser((user, done) => {
  done(null, user);
});

passport.deserializeUser((user, done) => {
  done(null, user);
});

if (googleOAuthConfigured) {
  passport.use(
    new GoogleStrategy(
      {
        clientID: process.env.GOOGLE_CLIENT_ID,
        clientSecret: process.env.GOOGLE_CLIENT_SECRET,
        callbackURL: configuredGoogleCallbackUrl,
      },
      async (_accessToken, _refreshToken, profile, done) => {
        try {
          const email = profile.emails?.[0]?.value;
          if (!email) {
            return done(null, false, { message: 'Google account email is required.' });
          }

          const avatarUrl = profile.photos?.[0]?.value || '';
          const googleUser = {
            id: null,
            google_id: profile.id,
            email,
            name: profile.displayName || email,
            avatar_url: avatarUrl,
            db_sync_error: null,
          };

          try {
            const userRecord = await syncGoogleUser(googleUser);
            return done(null, { ...googleUser, ...userRecord, db_sync_error: null });
          } catch (syncError) {
            console.error('Supabase user sync failed after Google login:', {
              message: syncError?.message,
              code: syncError?.code,
              status: syncError?.status,
            });
            return done(null, {
              ...googleUser,
              db_sync_error: syncError?.message || 'Supabase sync failed',
            });
          }
        } catch (error) {
          return done(error);
        }
      },
    ),
  );
}

const STRUCTURED_SYSTEM_PROMPT = `ROLE: You are an expert SPF prompt engineer. You analyze user tasks and generate production-ready SPF prompts.

Your output must always be a complete SPF prompt, not the final app, code, document, or content.
Return ONLY the SPF prompt. No explanation before or after.

GLOBAL SPF STRUCTURE:
For tasks that do not require a user-uploaded file, generate sections in this exact order:
@model
@context
@skills
@task
@sections
@design_system
@rules
@validators
@failure_policy
@output

For tasks that require a user-uploaded file, document, spreadsheet, image, archive, or dataset, generate sections in this exact order:
@model
@init
@context
@skills
@task
@sections
@design_system
@rules
@validators
@failure_policy
@output

SECTION STYLE CONTRACT:
- Use the exact @section heading style shown above.
- Write clear, executable instructions.
- Do not ask questions. Infer missing details conservatively.
- Do not include placeholder sections, TODO comments, dummy content, or example templates.
- Do not place final HTML, code, legal drafts, generated documents, or filled templates inside the SPF prompt.
- @output must be a short delivery contract only: target filename, whether to print code, file shape, and required starting text if relevant.

FILE INPUT / UPLOAD INIT CONTRACT:
- If the task depends on any user-supplied file or attachment, @init is mandatory.
- File-dependent tasks include, but are not limited to: PDF analysis, legal documents, homework files, Excel/XLSX, CSV, TXT, DOC/DOCX, images, screenshots, audio/video files, ZIP archives, datasets, reports, contracts, invoices, resumes, or any task that says "uploaded file", "belge", "dosya", "PDF", "Excel", "CSV", "TXT", "image", or equivalent.
- Place @init immediately after @model and before @context.
- In @init, instruct the executor to ask for the required file first, say nothing else, then wait.
- Adapt the upload sentence to the domain and file type. Examples: "Analiz edilecek dosyanızı yükleyin.", "Excel dosyanızı yükleyin.", "Ödev dosyanızı yükleyin.", "Dava dosyanızı (PDF) yükleyin."
- Never start analysis, generate HTML/code/content, infer missing facts, or use sample data before the required file is uploaded.
- In @task, step 1 must explicitly enforce the @init rule and waiting for the file.
- In @validators, include init_respected == true for every file-dependent task.
- In @failure_policy, state that no placeholder output may be returned when the file is missing.

REQUIRED @init SHAPE FOR FILE-DEPENDENT TASKS:
@init
Başlamadan önce yalnızca şunu söyle, başka hiçbir şey yazma:
"<domain-specific file upload request>"
Ardından dosyayı bekle.
Dosya yüklenmeden hiçbir analiz yapma, hiçbir çıktı üretme, hiçbir varsayımda bulunma.
Dosya yüklendikten sonra @task adımlarını sırayla uygula.

SKILL REGISTRY:
{
  "python": ["python-skill","pytest-skill","pip-skill"],
  "postgresql": ["postgres-mcp","alembic-skill","pgvector-skill"],
  "web": ["fastapi-skill","nginx-skill","cors-skill"],
  "frontend": ["react-skill","nextjs-skill","vite-skill","tailwind-skill"],
  "css": ["animations-skill","responsive-skill","darkmode-skill"],
  "landing": ["hero-skill","pricing-skill","testimonials-skill","cta-skill","faq-skill"],
  "excel": ["excel-reader-skill","chart-builder-skill","data-analyzer-skill"],
  "pdf": ["pdf-extractor-skill","pdf-builder-skill","document-mapper-skill"],
  "legal": ["case-analyzer-skill","legal-researcher-skill","defense-builder-skill"],
  "email": ["smtp-skill","resend-mcp","imap-skill"],
  "auth": ["jwt-skill","oauth-mcp"],
  "ai": ["openai-mcp","anthropic-mcp","langchain-skill"],
  "scraping": ["playwright-mcp","beautifulsoup-skill"],
  "deploy": ["vercel-mcp","netlify-mcp","github-actions-skill"],
  "image": ["sharp-skill","cloudinary-mcp","unsplash-mcp"],
  "animation": ["framer-skill","gsap-skill","lottie-skill"],
  "payment": ["stripe-mcp","paddle-mcp"],
  "form": ["formspree-mcp","zod-skill"],
  "seo": ["meta-skill","sitemap-skill","og-skill"],
  "analytics": ["gtag-skill","hotjar-mcp","plausible-mcp"],
  "database": ["prisma-skill","drizzle-skill","redis-mcp"],
  "cms": ["sanity-mcp","contentful-mcp","notion-mcp"]
}

SKILL_WRITING_RULES:
Kullanıcı bir görev verdiğinde, o göreve uygun skill bloklarını SPF format kurallarına göre kendin yaz ve prompta ekle.
Do not only list skill names. @skills must contain concrete SKILL blocks that are directly usable by the executor.
If the registry has a useful skill name, use it as inspiration; if the task needs a new skill, create it.

Bir skill yazarken şu formata kesinlikle uy:

SKILL: skill-name
- Ne yapar: tek cümle, net
- Input: ne alır
- Output: ne üretir
- Adımlar:
  1. Somut adım
  2. Somut adım
  3. Somut adım
- Edge cases:
  - Boş input → ne yapar
  - Hatalı format → ne yapar
  - Bulamazsa → ne yapar

SKILL YAZMA KURALLARI:
- Adımlar muğlak olamaz: "analiz et" değil "her satırı X kritere göre tara".
- Her skill bağımsız çalışmalı.
- Başka skill'e bağımlıysa belirt: Requires: xxx-skill
- Skill adı lowercase hyphenated olmalı: pdf-extractor, chart-builder, defense-builder.
- Output bir sonraki skill'in input'u olabilecek şekilde tanımlanmalı.
- Create as many skills as the task needs, but keep them focused and non-overlapping.
- For file-dependent tasks, include at least one extractor/reader skill for the file type and one domain processor skill for the requested outcome.
- For frontend/UI tasks, include skills such as icon-system, typography, layout-system, animation-system, component-builder, accessibility-checker, and responsive-validator when relevant.

LANDING / FRONTEND SINGLE HTML PROMPT STANDARD:
When the task is a landing page, website, single HTML app, UI, frontend, or marketing page, shape the prompt like this:

@model
You are a senior frontend developer and UI/UX designer.
You do not ask questions. You execute.
Return working, production-ready code only.
No explanation before or after code.
Start directly with <!DOCTYPE html>

@context
Include Product, Tagline, Description, URL or delivery surface, target audience, and important constraints inferred from the user task.

@skills
Define concrete skills as named blocks, such as icon-system, typography, animation-system, mockup-builder, responsive-layout, accessibility, and performance.
For icon-system, prefer Lucide Icons CDN and data-lucide attributes. Never use emoji as icons.

@task
State the exact build task in one sentence.

@sections
Break the requested page or app into numbered sections. Each section must include visible copy, layout, controls, icons, and responsive behavior.

@design_system
Define CSS custom properties for background, surfaces, borders, accent, text, success/error states, radii, spacing, and transitions.

@rules
Include implementation rules such as single HTML file, inline CSS/JS when requested, no CSS frameworks when requested, responsive breakpoint, animations, smooth scroll, and vanilla JS.

@validators
List boolean validators for the requested deliverable, for example:
lucide_icons_used == true
no_emoji == true
google_fonts_loaded == true
single_html_file == true
mobile_responsive == true
no_css_frameworks == true

@failure_policy
If any validator fails, fix before returning.
Never return placeholder sections.
Never return TODO comments.
If an icon name is invalid, use a valid alternative from Lucide.

@output
Save as landing.html in current directory.
Do not print code to chat.
Single file - all CSS and JS inline.
Start directly with <!DOCTYPE html>

For landing/frontend single HTML tasks, the @output block must be exactly the four lines above after the @output heading.
Do not add bullets, quotes, markdown fences, alternative filenames, or extra explanation in @output.

GENERAL GENERATION RULES:
1. Detect language and domain.
2. Extract relevant tags from the registry.
3. Select appropriate existing skills and MCPs.
4. Write task-specific SKILL blocks using SKILL_WRITING_RULES and place them inside @skills.
5. Decide whether the task requires a user-uploaded file. If yes, include @init. If no, omit @init.
6. Use the correct global SPF structure for every task.
7. Adapt @sections, @design_system, @rules, @validators, @failure_policy, and @output to the task domain.
8. Do not collapse every file workflow into legal/PDF. Excel, TXT, CSV, homework PDFs, images, datasets, and legal files must each get domain-appropriate @init text, skills, sections, validators, and output filenames.
9. For non-frontend tasks, keep @design_system as "Not applicable" only if there is no UI or document styling surface.
10. Never output a filled template inside @output.
11. Return ONLY the SPF prompt.`;

function escapeHtml(value = '') {
  return String(value).replace(/[&<>"']/g, (char) => {
    const entities = {
      '&': '&amp;',
      '<': '&lt;',
      '>': '&gt;',
      '"': '&quot;',
      "'": '&#39;',
    };
    return entities[char];
  });
}

function safeJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c');
}

function requireAuth(req, res, next) {
  if (req.isAuthenticated()) return next();
  if (req.path.startsWith('/api/')) {
    return res.status(401).json({ error: 'Authentication required' });
  }
  return res.redirect('/login');
}

function ensureSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw Object.assign(new Error('Supabase configuration is missing.'), { status: 500 });
  }
  return supabaseAdmin;
}

async function syncGoogleUser(profileUser) {
  const client = ensureSupabaseAdmin();
  const payload = {
    google_id: profileUser.google_id,
    email: profileUser.email,
    name: profileUser.name,
    avatar_url: profileUser.avatar_url,
    last_login: new Date().toISOString(),
  };

  const { data, error } = await client
    .from('users')
    .upsert(payload, { onConflict: 'google_id' })
    .select('id, google_id, email, name, avatar_url, last_login')
    .single();

  if (error) throw error;
  return data;
}

async function fetchUserPrompts(userId) {
  if (!userId) return [];
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('prompts')
    .select('id, task, generated_prompt, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) throw error;
  return data || [];
}

function getGeminiClient() {
  if (process.env.GEMINI_API_KEY) {
    return new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
  }

  const credentialsPath =
    process.env.GEMINI_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;

  let credentialsProject;

  if (credentialsPath) {
    if (!fs.existsSync(credentialsPath)) {
      throw Object.assign(new Error(`Credentials file not found: ${credentialsPath}`), {
        status: 401,
      });
    }

    const credentials = JSON.parse(fs.readFileSync(credentialsPath, 'utf8'));
    credentialsProject = credentials.project_id || credentials.quota_project_id;
    process.env.GOOGLE_APPLICATION_CREDENTIALS = credentialsPath;
  }

  const project =
    process.env.GOOGLE_CLOUD_PROJECT ||
    process.env.GOOGLE_PROJECT_ID ||
    credentialsProject;
  const location =
    process.env.GOOGLE_CLOUD_LOCATION ||
    process.env.GOOGLE_LOCATION ||
    'global';

  if (!project) {
    throw Object.assign(new Error('GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT is required.'), {
      status: 401,
    });
  }

  return new GoogleGenAI({
    vertexai: true,
    project,
    location,
  });
}

function getModelName() {
  return (
    process.env.GEMINI_MODEL ||
    process.env.GEMINI_MODEL_NAME ||
    process.env.GEMINI_STABLE_FALLBACK_MODEL_NAME ||
    'gemini-2.5-pro'
  );
}

function getConfiguredProject() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID || 'configured project';
}

function handleError(res, error) {
  console.error(error);
  if (error.message?.includes('BILLING_DISABLED') || error.message?.includes('requires billing to be enabled')) {
    return res.status(403).json({
      error: `Google Cloud projesinde faturalandirma kapali. Vertex AI/Gemini cagrisi icin ${getConfiguredProject()} projesinde billing etkinlestirilmeli.`,
    });
  }
  if (error.message?.includes('aiplatform.endpoints.predict') || error.message?.includes('IAM_PERMISSION_DENIED')) {
    return res.status(403).json({
      error: `Servis hesabinda ${getConfiguredProject()} projesi icin Vertex AI predict izni yok. IAM tarafinda Vertex AI User rolunu veya aiplatform.endpoints.predict iznini ekleyin.`,
    });
  }
  if (error.status === 401 || error.status === 403) {
    return res.status(401).json({
      error: 'Servis hesabi ile Gemini/Vertex AI yetkilendirmesi basarisiz. JSON dosyasini, Vertex AI API erisimini ve IAM rollerini kontrol edin.',
    });
  }
  if (error.name === 'AbortError') {
    return res.status(504).json({ error: 'Request timeout' });
  }
  return res.status(error.status || 500).json({ error: error.message || 'Internal server error' });
}

function renderStyles() {
  return `<style>
    :root {
      --bg: #0a0a0a;
      --surface: #111111;
      --surface2: #1a1a1a;
      --border: #2a2a2a;
      --accent: #7C3AED;
      --accent-hover: #6D28D9;
      --text-primary: #ffffff;
      --text-secondary: #a1a1aa;
      --muted: #71717a;
      --danger: #ef4444;
      --success: #22c55e;
      --shadow: rgba(124, 58, 237, 0.2);
    }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    html { scroll-behavior: smooth; }
    body {
      min-height: 100vh;
      background: var(--bg);
      color: var(--text-primary);
      font-family: Inter, system-ui, sans-serif;
      overflow-x: hidden;
    }
    body::before {
      content: "";
      position: fixed;
      inset: -20%;
      z-index: -2;
      background:
        radial-gradient(circle at 18% 14%, rgba(124, 58, 237, 0.14), transparent 30%),
        radial-gradient(circle at 82% 18%, rgba(109, 40, 217, 0.12), transparent 30%),
        radial-gradient(circle at 50% 88%, rgba(124, 58, 237, 0.08), transparent 24%);
      animation: meshDrift 8s ease-in-out infinite alternate;
    }
    body::after {
      content: "";
      position: fixed;
      inset: 0;
      z-index: -1;
      background: linear-gradient(180deg, rgba(10, 10, 10, 0.3), var(--bg));
      pointer-events: none;
    }
    @keyframes meshDrift {
      from { transform: translate3d(-1%, -1%, 0) scale(1); }
      to { transform: translate3d(1%, 1%, 0) scale(1.04); }
    }
    a { color: inherit; text-decoration: none; }
    button, textarea, input { font: inherit; }
    .navbar {
      position: sticky;
      top: 0;
      z-index: 50;
      background: rgba(10, 10, 10, 0.78);
      backdrop-filter: blur(16px);
      border-bottom: 1px solid var(--border);
    }
    .nav-inner {
      width: min(100% - 40px, 1180px);
      min-height: 76px;
      margin: 0 auto;
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 18px;
    }
    .brand {
      display: inline-flex;
      align-items: center;
      gap: 11px;
      font-family: "Space Grotesk", sans-serif;
      font-size: 18px;
      font-weight: 800;
    }
    .brand-icon {
      display: grid;
      place-items: center;
      width: 40px;
      height: 40px;
      border-radius: 10px;
      background: #1e1e2e;
      border: 1px solid var(--border);
      color: var(--accent);
    }
    .nav-links {
      display: flex;
      align-items: center;
      gap: 22px;
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 700;
    }
    .nav-links a:hover { color: var(--accent); }
    .btn {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      gap: 9px;
      min-height: 44px;
      padding: 0 16px;
      border-radius: 8px;
      border: 1px solid transparent;
      color: var(--text-primary);
      background: transparent;
      font-weight: 800;
      cursor: pointer;
      transition: background 0.2s ease, border-color 0.2s ease, transform 0.2s ease, box-shadow 0.2s ease;
    }
    .btn:hover { transform: translateY(-2px); }
    .btn-primary { background: var(--accent); box-shadow: 0 18px 45px var(--shadow); }
    .btn-primary:hover { background: var(--accent-hover); }
    .btn-ghost { background: rgba(255,255,255,0.03); border-color: var(--border); }
    .btn-danger { background: rgba(239, 68, 68, 0.1); color: #fecaca; border-color: rgba(239, 68, 68, 0.35); }
    .user-menu { position: relative; }
    .user-button {
      display: inline-flex;
      align-items: center;
      gap: 10px;
      min-height: 46px;
      padding: 5px 8px 5px 5px;
      border-radius: 999px;
      border: 1px solid var(--border);
      background: rgba(255,255,255,0.04);
      color: var(--text-primary);
      cursor: pointer;
    }
    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
      background: var(--surface2);
      border: 1px solid var(--border);
    }
    .user-name {
      max-width: 150px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 800;
      font-size: 14px;
    }
    .dropdown {
      position: absolute;
      top: calc(100% + 10px);
      right: 0;
      display: none;
      min-width: 190px;
      padding: 8px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      box-shadow: 0 24px 70px rgba(0,0,0,0.32);
    }
    .dropdown.open { display: grid; }
    .dropdown a {
      display: flex;
      align-items: center;
      gap: 9px;
      padding: 10px;
      border-radius: 7px;
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 800;
    }
    .dropdown a:hover { background: var(--surface2); color: var(--text-primary); }
    .shell {
      width: min(100% - 40px, 1120px);
      margin: 0 auto;
      padding: 52px 0 72px;
    }
    .hero-copy { margin-bottom: 24px; }
    .eyeline {
      color: var(--accent);
      font-size: 13px;
      font-weight: 900;
      letter-spacing: 0.1em;
      text-transform: uppercase;
      margin-bottom: 14px;
    }
    h1, h2, h3 { font-family: "Space Grotesk", sans-serif; letter-spacing: 0; }
    h1 { max-width: 800px; font-size: clamp(42px, 7vw, 84px); line-height: 0.94; }
    h2 { font-size: clamp(28px, 4vw, 44px); }
    .subtitle {
      max-width: 660px;
      margin-top: 18px;
      color: var(--text-secondary);
      font-size: 18px;
      line-height: 1.7;
    }
    .factory-grid {
      display: grid;
      grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
      gap: 18px;
      align-items: stretch;
    }
    .panel, .prompt-card, .stat-card, .modal-panel {
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(17,17,17,0.86);
      box-shadow: 0 24px 80px rgba(0,0,0,0.18);
    }
    .panel { padding: 18px; }
    .panel-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 14px;
    }
    .panel-title {
      display: flex;
      align-items: center;
      gap: 10px;
      font-weight: 900;
    }
    textarea, input {
      width: 100%;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: #0d0d0d;
      color: var(--text-primary);
      outline: none;
      resize: vertical;
    }
    textarea {
      min-height: 320px;
      padding: 16px;
      line-height: 1.65;
    }
    input {
      min-height: 46px;
      padding: 0 14px;
    }
    textarea:focus, input:focus {
      border-color: var(--accent);
      box-shadow: 0 0 0 3px rgba(124, 58, 237, 0.16);
    }
    .status {
      min-height: 24px;
      margin-top: 12px;
      color: var(--text-secondary);
      font-size: 14px;
      font-weight: 700;
    }
    .status.error { color: #fecaca; }
    .actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      margin-top: 14px;
      flex-wrap: wrap;
    }
    .login-screen {
      min-height: 100vh;
      display: grid;
      place-items: center;
      padding: 24px;
    }
    .login-card {
      width: min(100%, 430px);
      padding: 32px;
      text-align: center;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: rgba(17,17,17,0.92);
      box-shadow: 0 30px 90px rgba(0,0,0,0.34);
    }
    .login-card .brand-icon { margin: 0 auto 18px; width: 54px; height: 54px; }
    .login-card h1 { font-size: 34px; line-height: 1.05; margin-bottom: 10px; }
    .google-btn {
      width: 100%;
      min-height: 50px;
      margin-top: 24px;
      background: #ffffff;
      color: #111111;
      border: 0;
      box-shadow: 0 14px 32px rgba(255,255,255,0.08);
    }
    .google-btn:hover { box-shadow: 0 20px 44px rgba(255,255,255,0.14); }
    .terms { margin-top: 16px; color: var(--muted); font-size: 12px; line-height: 1.6; }
    .profile-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 24px;
      margin-bottom: 22px;
    }
    .profile-identity {
      display: flex;
      align-items: center;
      gap: 16px;
      min-width: 0;
    }
    .profile-avatar { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; border: 1px solid var(--border); }
    .profile-email { margin-top: 4px; color: var(--text-secondary); overflow-wrap: anywhere; }
    .stats {
      display: grid;
      grid-template-columns: repeat(3, minmax(0, 1fr));
      gap: 14px;
      margin-bottom: 28px;
    }
    .stat-card { padding: 16px; }
    .stat-label { color: var(--text-secondary); font-size: 13px; font-weight: 800; }
    .stat-value { margin-top: 8px; font: 800 28px "Space Grotesk", sans-serif; }
    .dashboard-head {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 16px;
      margin-bottom: 16px;
      flex-wrap: wrap;
    }
    .badge {
      display: inline-flex;
      align-items: center;
      min-height: 28px;
      padding: 0 10px;
      border-radius: 999px;
      background: rgba(124, 58, 237, 0.14);
      color: #ddd6fe;
      font-size: 13px;
      font-weight: 900;
    }
    .search-row { margin-bottom: 18px; }
    .prompt-grid {
      display: grid;
      grid-template-columns: repeat(2, minmax(0, 1fr));
      gap: 14px;
    }
    .prompt-card {
      display: grid;
      gap: 16px;
      padding: 16px;
    }
    .prompt-task { color: var(--text-primary); line-height: 1.6; overflow-wrap: anywhere; }
    .prompt-date { color: var(--text-secondary); font-size: 13px; font-weight: 800; }
    .card-actions { display: flex; gap: 8px; flex-wrap: wrap; }
    .empty-state {
      display: none;
      place-items: center;
      gap: 14px;
      min-height: 280px;
      text-align: center;
      border: 1px dashed var(--border);
      border-radius: 8px;
      background: rgba(17,17,17,0.64);
    }
    .empty-state.visible { display: grid; }
    .empty-icon {
      display: grid;
      place-items: center;
      width: 58px;
      height: 58px;
      margin: 0 auto;
      border-radius: 14px;
      background: rgba(124, 58, 237, 0.14);
      color: var(--accent);
    }
    .modal {
      position: fixed;
      inset: 0;
      z-index: 100;
      display: none;
      place-items: center;
      padding: 20px;
      background: rgba(0,0,0,0.72);
      backdrop-filter: blur(8px);
    }
    .modal.open { display: grid; }
    .modal-panel {
      width: min(100%, 860px);
      max-height: min(760px, 90vh);
      display: grid;
      grid-template-rows: auto 1fr auto;
      overflow: hidden;
    }
    .modal-head, .modal-actions {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
      padding: 16px;
      border-bottom: 1px solid var(--border);
    }
    .modal-actions { border-top: 1px solid var(--border); border-bottom: 0; }
    .modal-body {
      padding: 16px;
      overflow: auto;
      white-space: pre-wrap;
      line-height: 1.7;
      color: #e4e4e7;
    }
    @media (max-width: 768px) {
      .nav-inner { width: min(100% - 28px, 1180px); min-height: 68px; }
      .nav-links { display: none; }
      .user-name { display: none; }
      .shell { width: min(100% - 28px, 1120px); padding-top: 34px; }
      .factory-grid, .prompt-grid, .stats { grid-template-columns: 1fr; }
      .profile-header { align-items: flex-start; flex-direction: column; }
      textarea { min-height: 260px; }
      .login-card { padding: 24px; }
      h1 { font-size: clamp(36px, 12vw, 54px); }
    }
  </style>`;
}

function renderHead(title) {
  return `<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>${escapeHtml(title)}</title>
    <link rel="preconnect" href="https://fonts.googleapis.com">
    <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
    <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800;900&family=Space+Grotesk:wght@600;700;800&display=swap" rel="stylesheet">
    <script src="https://unpkg.com/lucide@latest/dist/umd/lucide.min.js"></script>
    ${renderStyles()}
  </head>`;
}

function renderBrand() {
  return `<a class="brand" href="/" aria-label="SPF Prompt Factory">
    <span class="brand-icon"><i data-lucide="factory"></i></span>
    <span><span style="color:var(--accent)">SPF</span> Prompt Factory</span>
  </a>`;
}

function renderNavbar(user) {
  const avatar = escapeHtml(user?.avatar_url || '');
  const name = escapeHtml(user?.name || 'Kullanıcı');
  return `<header class="navbar">
    <div class="nav-inner">
      ${renderBrand()}
      <nav class="nav-links" aria-label="Ana menü">
        <a href="/app">Üretici</a>
        <a href="/profile">Profil</a>
      </nav>
      ${
        user
          ? `<div class="user-menu">
              <button class="user-button" id="userMenuButton" type="button" aria-expanded="false" aria-haspopup="true">
                <img class="avatar" src="${avatar}" alt="${name}">
                <span class="user-name">${name}</span>
                <i data-lucide="chevron-down"></i>
              </button>
              <div class="dropdown" id="userDropdown">
                <a href="/profile"><i data-lucide="user"></i> Profilim</a>
                <a href="/auth/logout"><i data-lucide="log-out"></i> Çıkış Yap</a>
              </div>
            </div>`
          : `<a class="btn btn-primary" href="/login"><i data-lucide="log-in"></i> Giriş Yap</a>`
      }
    </div>
  </header>`;
}

function renderNavbarScript() {
  return `<script>
    lucide.createIcons();
    const userMenuButton = document.getElementById('userMenuButton');
    const userDropdown = document.getElementById('userDropdown');
    if (userMenuButton && userDropdown) {
      userMenuButton.addEventListener('click', () => {
        const isOpen = userDropdown.classList.toggle('open');
        userMenuButton.setAttribute('aria-expanded', String(isOpen));
      });
      document.addEventListener('click', (event) => {
        if (!event.target.closest('.user-menu')) {
          userDropdown.classList.remove('open');
          userMenuButton.setAttribute('aria-expanded', 'false');
        }
      });
    }
  </script>`;
}

function renderLoginPage() {
  return `<!DOCTYPE html>
<html lang="tr">
${renderHead('Giriş Yap - SPF Prompt Factory')}
<body>
  <main class="login-screen">
    <section class="login-card" aria-label="Giriş">
      <div style="display:flex;justify-content:center;margin-bottom:18px">${renderBrand()}</div>
      <h1 style="font-size:28px">SPF Prompt Factory</h1>
      <p class="subtitle" style="margin:0 auto">Derdini anlat, model talimatını al.</p>
      <a class="btn google-btn" href="/auth/google">
        <svg width="20" height="20" viewBox="0 0 48 48" aria-hidden="true">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.6 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 13 4 4 13 4 24s9 20 20 20 20-9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.2 4 9.5 8.5 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.5-5.2l-6.2-5.2C29.3 35.1 26.8 36 24 36c-5.2 0-9.6-3.3-11.3-7.9l-6.5 5C9.4 39.5 16.1 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.3-2.3 4.2-4 5.6l6.2 5.2C37.1 39.1 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
        </svg>
        Google ile Giriş Yap
      </a>
      <p class="terms">Giriş yaparak kullanım şartlarını kabul etmiş olursunuz.</p>
    </section>
  </main>
  <script>lucide.createIcons();</script>
</body>
</html>`;
}

function renderAppPage(user) {
  return `<!DOCTYPE html>
<html lang="tr">
${renderHead('SPF Prompt Factory App')}
<body>
  ${renderNavbar(user)}
  <main class="shell">
    <section class="hero-copy">
      <p class="eyeline">SPF Prompt Factory</p>
      <h1>Derdini anlat, sistem nokta atışı SPF prompt üretsin.</h1>
      <p class="subtitle">Görevi yaz, Gemini 2.5 Pro ile yapılandırılmış, çalıştırılabilir bir SPF prompt al. Ürettiğin promptlar profilinde saklanır.</p>
    </section>
    <section class="factory-grid" aria-label="SPF prompt üretici">
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><i data-lucide="message-square-text"></i> Görev</div>
        </div>
        <textarea id="taskInput" rows="15" placeholder="Örn: Bir hukuk PDF'inden savunma HTML'i üreten ajan promptu oluştur."></textarea>
        <div class="actions">
          <button id="generateBtn" class="btn btn-primary" type="button"><i data-lucide="sparkles"></i> Prompt Üret</button>
          <span id="status" class="status" role="status"></span>
        </div>
      </div>
      <div class="panel">
        <div class="panel-head">
          <div class="panel-title"><i data-lucide="scroll-text"></i> SPF Prompt</div>
          <button id="copyBtn" class="btn btn-ghost" type="button"><i data-lucide="copy"></i> Kopyala</button>
        </div>
        <textarea id="promptOutput" rows="15" readonly placeholder="Üretilen SPF prompt burada görünecek."></textarea>
      </div>
    </section>
  </main>
  ${renderNavbarScript()}
  <script>
    const taskInput = document.getElementById('taskInput');
    const promptOutput = document.getElementById('promptOutput');
    const generateBtn = document.getElementById('generateBtn');
    const copyBtn = document.getElementById('copyBtn');
    const statusEl = document.getElementById('status');

    function setStatus(message, isError = false) {
      statusEl.textContent = message;
      statusEl.classList.toggle('error', isError);
    }

    generateBtn.addEventListener('click', async () => {
      const task = taskInput.value.trim();
      if (!task) {
        setStatus('Görev metni gerekli.', true);
        return;
      }
      generateBtn.disabled = true;
      generateBtn.innerHTML = '<i data-lucide="loader-circle"></i> Üretiliyor';
      lucide.createIcons();
      setStatus('Gemini promptu hazırlıyor...');

      try {
        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ task })
        });
        const data = await response.json();
        if (!response.ok) throw new Error(data.error || 'Prompt üretilemedi.');
        promptOutput.value = data.prompt;
        setStatus(data.prompt_id ? 'Prompt üretildi ve profilinize kaydedildi.' : 'Prompt üretildi.');
      } catch (error) {
        setStatus(error.message || 'Beklenmeyen hata oluştu.', true);
      } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i data-lucide="sparkles"></i> Prompt Üret';
        lucide.createIcons();
      }
    });

    copyBtn.addEventListener('click', async () => {
      if (!promptOutput.value.trim()) return;
      await navigator.clipboard.writeText(promptOutput.value);
      copyBtn.innerHTML = '<i data-lucide="check"></i> Kopyalandı';
      lucide.createIcons();
      setTimeout(() => {
        copyBtn.innerHTML = '<i data-lucide="copy"></i> Kopyala';
        lucide.createIcons();
      }, 1400);
    });
  </script>
</body>
</html>`;
}

function renderProfilePage(user, prompts) {
  const currentMonth = new Date().getMonth();
  const currentYear = new Date().getFullYear();
  const monthCount = prompts.filter((prompt) => {
    const createdAt = new Date(prompt.created_at);
    return createdAt.getMonth() === currentMonth && createdAt.getFullYear() === currentYear;
  }).length;
  const lastActivity = prompts[0]
    ? new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(prompts[0].created_at))
    : 'Yok';

  return `<!DOCTYPE html>
<html lang="tr">
${renderHead('Profil - SPF Prompt Factory')}
<body>
  ${renderNavbar(user)}
  <main class="shell">
    <section class="profile-header">
      <div class="profile-identity">
        <img class="profile-avatar" src="${escapeHtml(user.avatar_url || '')}" alt="${escapeHtml(user.name || 'Profil')}">
        <div>
          <h1 style="font-size:42px">${escapeHtml(user.name || 'Profil')}</h1>
          <p class="profile-email">${escapeHtml(user.email || '')}</p>
        </div>
      </div>
      <a class="btn btn-primary" href="/app"><i data-lucide="sparkles"></i> Prompt Üret</a>
    </section>

    <section class="stats" aria-label="Profil istatistikleri">
      <div class="stat-card">
        <div class="stat-label">Toplam Prompt</div>
        <div class="stat-value">${prompts.length}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Bu Ay</div>
        <div class="stat-value">${monthCount}</div>
      </div>
      <div class="stat-card">
        <div class="stat-label">Son Aktivite</div>
        <div class="stat-value" style="font-size:20px">${escapeHtml(lastActivity)}</div>
      </div>
    </section>

    <section aria-label="Prompt Dashboard">
      <div class="dashboard-head">
        <h2>Kayıtlı Promptlarım</h2>
        <span class="badge" id="promptCount">${prompts.length} prompt</span>
      </div>
      <div class="search-row">
        <input id="searchInput" type="search" placeholder="Promptlarda ara">
      </div>
      <div class="prompt-grid" id="promptGrid"></div>
      <div class="empty-state" id="emptyState">
        <div>
          <div class="empty-icon"><i data-lucide="inbox"></i></div>
          <h3 style="margin-top:14px">Henüz prompt oluşturmadınız.</h3>
          <p class="subtitle" style="margin:8px auto 18px">İlk promptunuzu oluşturduğunuzda burada listelenecek.</p>
          <a class="btn btn-primary" href="/app"><i data-lucide="sparkles"></i> İlk Promptumu Oluştur</a>
        </div>
      </div>
    </section>
  </main>

  <div class="modal" id="promptModal" role="dialog" aria-modal="true" aria-labelledby="modalTitle">
    <section class="modal-panel">
      <div class="modal-head">
        <h3 id="modalTitle">Prompt</h3>
        <button class="btn btn-ghost" id="closeModal" type="button" aria-label="Kapat"><i data-lucide="x"></i></button>
      </div>
      <div class="modal-body" id="modalBody"></div>
      <div class="modal-actions">
        <button class="btn btn-primary" id="copyModal" type="button"><i data-lucide="copy"></i> Kopyala</button>
        <button class="btn btn-ghost" id="closeModalBottom" type="button">Kapat</button>
      </div>
    </section>
  </div>

  ${renderNavbarScript()}
  <script>
    const prompts = ${safeJson(prompts)};
    const promptGrid = document.getElementById('promptGrid');
    const emptyState = document.getElementById('emptyState');
    const searchInput = document.getElementById('searchInput');
    const promptCount = document.getElementById('promptCount');
    const modal = document.getElementById('promptModal');
    const modalBody = document.getElementById('modalBody');
    const closeModal = document.getElementById('closeModal');
    const closeModalBottom = document.getElementById('closeModalBottom');
    const copyModal = document.getElementById('copyModal');
    let activePrompt = '';

    function formatDate(value) {
      return new Intl.DateTimeFormat('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(value));
    }

    function truncate(value, limit = 100) {
      return value.length > limit ? value.slice(0, limit).trim() + '...' : value;
    }

    function renderPrompts() {
      const query = searchInput.value.trim().toLowerCase();
      const filtered = prompts.filter((prompt) => {
        return prompt.task.toLowerCase().includes(query) || prompt.generated_prompt.toLowerCase().includes(query);
      });

      promptGrid.innerHTML = filtered.map((prompt) => \`
        <article class="prompt-card" data-id="\${prompt.id}">
          <div>
            <p class="prompt-task">\${escapeHtmlClient(truncate(prompt.task))}</p>
            <p class="prompt-date">\${formatDate(prompt.created_at)}</p>
          </div>
          <div class="card-actions">
            <button class="btn btn-ghost" type="button" data-action="view" data-id="\${prompt.id}"><i data-lucide="eye"></i> Görüntüle</button>
            <button class="btn btn-ghost" type="button" data-action="copy" data-id="\${prompt.id}"><i data-lucide="copy"></i> Kopyala</button>
            <button class="btn btn-danger" type="button" data-action="delete" data-id="\${prompt.id}"><i data-lucide="trash-2"></i> Sil</button>
          </div>
        </article>
      \`).join('');

      emptyState.classList.toggle('visible', filtered.length === 0);
      promptCount.textContent = filtered.length + ' prompt';
      lucide.createIcons();
    }

    function escapeHtmlClient(value) {
      return String(value).replace(/[&<>"']/g, (char) => ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;'
      })[char]);
    }

    function findPrompt(id) {
      return prompts.find((prompt) => prompt.id === id);
    }

    function openPrompt(prompt) {
      activePrompt = prompt.generated_prompt;
      modalBody.textContent = prompt.generated_prompt;
      modal.classList.add('open');
    }

    function closePrompt() {
      modal.classList.remove('open');
      activePrompt = '';
    }

    promptGrid.addEventListener('click', async (event) => {
      const button = event.target.closest('button[data-action]');
      if (!button) return;
      const prompt = findPrompt(button.dataset.id);
      if (!prompt) return;

      if (button.dataset.action === 'view') {
        openPrompt(prompt);
      }

      if (button.dataset.action === 'copy') {
        await navigator.clipboard.writeText(prompt.generated_prompt);
        button.innerHTML = '<i data-lucide="check"></i> Kopyalandı';
        lucide.createIcons();
        setTimeout(() => {
          button.innerHTML = '<i data-lucide="copy"></i> Kopyala';
          lucide.createIcons();
        }, 1200);
      }

      if (button.dataset.action === 'delete') {
        button.disabled = true;
        const response = await fetch('/api/prompts/' + encodeURIComponent(prompt.id), { method: 'DELETE' });
        if (response.ok) {
          const index = prompts.findIndex((item) => item.id === prompt.id);
          if (index !== -1) prompts.splice(index, 1);
          renderPrompts();
        } else {
          button.disabled = false;
        }
      }
    });

    searchInput.addEventListener('input', renderPrompts);
    closeModal.addEventListener('click', closePrompt);
    closeModalBottom.addEventListener('click', closePrompt);
    modal.addEventListener('click', (event) => {
      if (event.target === modal) closePrompt();
    });
    copyModal.addEventListener('click', async () => {
      if (!activePrompt) return;
      await navigator.clipboard.writeText(activePrompt);
      copyModal.innerHTML = '<i data-lucide="check"></i> Kopyalandı';
      lucide.createIcons();
      setTimeout(() => {
        copyModal.innerHTML = '<i data-lucide="copy"></i> Kopyala';
        lucide.createIcons();
      }, 1200);
    });
    renderPrompts();
  </script>
</body>
</html>`;
}

app.get('/auth/google', (req, res, next) => {
  if (!googleOAuthConfigured) {
    return res.redirect('/login?error=missing_config');
  }
  return passport.authenticate('google', {
    scope: ['profile', 'email'],
    callbackURL: getGoogleCallbackUrl(req),
    prompt: 'select_account',
  })(req, res, next);
});

app.get('/auth/google/callback', (req, res, next) => {
  if (!googleOAuthConfigured) {
    return res.redirect('/login');
  }
  return passport.authenticate('google', {
    callbackURL: getGoogleCallbackUrl(req),
  }, (error, user) => {
    if (error) {
      logOAuthError(error);
      return res.redirect('/login');
    }
    if (!user) {
      return res.redirect('/login');
    }
    return req.logIn(user, (loginError) => {
      if (loginError) return next(loginError);
      return res.redirect('/profile');
    });
  })(req, res, next);
});

app.get('/auth/logout', (req, res, next) => {
  req.logout((error) => {
    if (error) return next(error);
    req.session.destroy(() => {
      res.clearCookie('connect.sid');
      res.redirect('/login');
    });
  });
});

app.get('/api/auth/session', (req, res) => {
  res.json({
    authenticated: req.isAuthenticated(),
    user: req.isAuthenticated()
      ? {
          id: req.user.id,
          email: req.user.email,
          name: req.user.name,
          avatar_url: req.user.avatar_url,
        }
      : null,
  });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({
    googleOAuthConfigured,
    supabaseConfigured: Boolean(supabaseAdmin),
    callbackUrl: configuredGoogleCallbackUrl,
  });
});

app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const { task } = req.body;
    if (!task || typeof task !== 'string' || !task.trim()) {
      return res.status(400).json({ error: 'Task is required' });
    }
    if (!req.user.id) {
      return res.status(503).json({
        error: 'Profil veritabanı henüz senkronize değil. Supabase tablolarını ve service key değerini kontrol edin.',
      });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: getModelName(),
      contents: task.trim(),
      config: {
        systemInstruction: STRUCTURED_SYSTEM_PROMPT,
      },
    });

    const prompt = response.text || '';
    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('prompts')
      .insert({
        user_id: req.user.id,
        task: task.trim(),
        generated_prompt: prompt,
      })
      .select('id')
      .single();

    if (error) throw error;
    return res.json({ prompt, prompt_id: data.id });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/prompts', requireAuth, async (req, res) => {
  try {
    const prompts = await fetchUserPrompts(req.user.id);
    return res.json({ prompts });
  } catch (error) {
    return handleError(res, error);
  }
});

app.delete('/api/prompts/:id', requireAuth, async (req, res) => {
  try {
    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('prompts')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Prompt not found' });
    return res.json({ ok: true });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/login', (req, res) => {
  if (req.isAuthenticated()) return res.redirect('/profile');
  return res.send(renderLoginPage());
});

app.get('/', (req, res) => {
  res.sendFile(process.cwd() + '/index.html');
});

app.get('/landing', (req, res) => {
  res.redirect(301, '/');
});

app.get('/app', requireAuth, (req, res) => {
  res.send(renderAppPage(req.user));
});

app.get('/profile', requireAuth, async (req, res) => {
  try {
    const prompts = await fetchUserPrompts(req.user.id);
    res.send(renderProfilePage(req.user, prompts));
  } catch (error) {
    res.status(error.status || 500).send(escapeHtml(error.message || 'Profile could not be loaded.'));
  }
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${port}`);
});
