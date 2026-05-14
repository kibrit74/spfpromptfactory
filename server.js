import fs from 'node:fs';
import path from 'node:path';
import dotenv from 'dotenv';
import express from 'express';
import cors from 'cors';
import session from 'express-session';
import sessionFileStoreFactory from 'session-file-store';
import passport from 'passport';
import { Strategy as GoogleStrategy } from 'passport-google-oauth20';
import { createClient } from '@supabase/supabase-js';
import { GoogleGenAI } from '@google/genai';
import { createServer as createViteServer } from 'vite';
import {
  buildAnalysisPrompt,
  buildRevisionPrompt,
  buildTaskWithContext,
  getNextVersionNumber,
  normalizeAnalysisPayload,
  parseJsonObject,
} from './server/prompt-intelligence.js';
import {
  CREDIT_COSTS,
  CREDIT_PACKAGES,
  canSpendCredits,
  getCreditCost,
  getCreditPackage,
} from './server/credits.js';
import {
  buildAdminCreditTransactionRows,
  buildAdminOverview,
  buildAdminUserRows,
  isAdminUser,
} from './server/admin-analytics.js';
import {
  buildActiveRecords,
  evaluateActionAccess,
  getDailyUsageCounts,
  normalizeUserControls,
} from './server/admin-controls.js';
import {
  applyMarketUserState,
  normalizeMarketSchemaError,
  normalizeMarketShareInput,
  rankMarketItems,
} from './server/prompt-market.js';
import {
  buildRuntimeStatus,
  getPromptPersistenceBlocker,
  normalizeSaveFailure,
} from './server/runtime-status.js';

dotenv.config({ path: ['.env.local', '.env'], quiet: true });

const app = express();
const port = Number(process.env.PORT || 8200);
const FileStore = sessionFileStoreFactory(session);
const sessionStorePath = path.join(process.cwd(), '.sessions');
const isDev = process.env.NODE_ENV !== 'production';
const useFileSessionStore = !isDev || process.env.SESSION_FILE_STORE === 'true';
const spaTemplatePath = path.join(process.cwd(), 'app.html');
const spaDistPath = path.join(process.cwd(), 'dist', 'app.html');
const sharedAuthUiPath = path.join(process.cwd(), 'public', 'auth-ui.js');

if (useFileSessionStore && !fs.existsSync(sessionStorePath)) {
  fs.mkdirSync(sessionStorePath, { recursive: true });
}

app.set('trust proxy', 1);
app.use(cors({ credentials: true, origin: true }));
app.use(express.json({ limit: '32kb' }));
app.use(express.urlencoded({ extended: false }));
app.use(
  session({
    secret: process.env.SESSION_SECRET || 'spf-prompt-factory-local-session-secret',
    ...(useFileSessionStore
      ? {
          store: new FileStore({
            path: sessionStorePath,
            ttl: 60 * 60 * 24 * 7,
            retries: 0,
            logFn: () => {},
          }),
        }
      : {}),
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
app.use(async (req, _res, next) => {
  if (
    !req.isAuthenticated?.() ||
    (
      req.user?.id &&
      typeof req.user?.is_admin !== 'undefined' &&
      typeof req.user?.is_blocked !== 'undefined'
    ) ||
    !req.user?.google_id ||
    !isSupabaseAdminAvailable()
  ) {
    return next();
  }

  try {
    await hydrateAuthenticatedUser(req);
  } catch (error) {
    if (supabaseAdminDisabledReason) {
      return next();
    }
    console.error('Deferred Supabase user hydration failed:', {
      message: error?.message,
      code: error?.code,
      status: error?.status,
    });
  }

  return next();
});

app.get('/.well-known/appspecific/com.chrome.devtools.json', (_req, res) => {
  res.status(204).end();
});

app.get('/auth-ui.js', (_req, res) => {
  res.type('application/javascript').sendFile(sharedAuthUiPath);
});

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;
let supabaseAdminDisabledReason = null;
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
const configuredAdminEmails = process.env.ADMIN_EMAILS || '';
const defaultAppUrl = process.env.APP_URL || `http://localhost:${port}`;
const configuredGoogleCallbackUrl =
  process.env.GOOGLE_CALLBACK_URL || `${normalizeBaseUrl(defaultAppUrl)}/auth/google/callback`;

function normalizeBaseUrl(value) {
  return String(value || `http://localhost:${port}`).replace(/\/+$/, '');
}

function isSupabaseAdminAvailable() {
  return Boolean(supabaseAdmin) && !supabaseAdminDisabledReason;
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

let vite = null;
if (isDev) {
  vite = await createViteServer({
    server: {
      middlewareMode: true,
      hmr: process.env.DISABLE_HMR !== 'true',
    },
    appType: 'custom',
  });
  app.use(vite.middlewares);
} else {
  const distAssetsPath = path.join(process.cwd(), 'dist', 'assets');
  if (fs.existsSync(distAssetsPath)) {
    app.use('/assets', express.static(distAssetsPath));
  }
}

async function renderSpaShell(req, res, next) {
  try {
    if (vite) {
      const template = await vite.transformIndexHtml(
        req.originalUrl,
        fs.readFileSync(spaTemplatePath, 'utf8'),
      );
      return res.status(200).type('html').send(template);
    }

    return res.sendFile(spaDistPath);
  } catch (error) {
    if (vite) {
      vite.ssrFixStacktrace(error);
    }
    return next(error);
  }
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

const STRUCTURED_SYSTEM_PROMPT = `# SPF Prompt Generator -- Sistem Promptu v1.0

@model
You are a world-class prompt engineer specializing in Structured Prompt Format (SPF).
Your sole purpose is to produce exhaustive, production-ready SPF system prompts.
You do not ask unnecessary questions. You extract intent from the user's description and build immediately.
You never produce vague, incomplete, or placeholder-filled prompts.
Every prompt you generate must be deployable without modification.

@identity
Sen bir SPF Prompt Mimarisin.
Kullanici senden bir arac, ajan, is akisi veya asistan icin sistem promptu uretmeni isteyecek.
Sen bu istegi alir, eksik bilgileri akillica varsayimlarla tamamlar ve asagidaki @spf_standard'a uygun, tam ve calisir bir SPF sistem promptu uretirsin.
Urettigin her prompt:
- Tek basina calisabilir olmali
- Hicbir bolumu bos veya TODO icermemeli
- Bir sonraki modelin sormadan anlayabilecegi netlikte olmali
- Guvenlik, kalite ve hata yonetimi kurallarini icermeli

@spf_standard
Her SPF promptu asagidaki bolumleri bu sirayla icermelidir:
Zorunlu Bolumler
@model          -> Modelin kim oldugu, rolu, davranis tarzi
@init           -> Ilk mesaj davranisi; kullanicidan ne beklenir
@context        -> Urun adi, aciklama, hedef kitle, cikti formati, ortam
@skills         -> Her yetenek blogu; bkz. @skill_anatomy
@task           -> Adim adim gorev akisi
@sections       -> Ciktinin bolum yapisi; rapor, sayfa, dokuman vb.
@design_system  -> Gorsel veya format kurallari; CSS, tipografi, renk, layout
@rules          -> Kesin davranis kurallari ve yasaklar
@validators     -> Dogrulama kontrol listesi; checkbox formatinda
@failure_policy -> Hata durumlarinda ne yapilacagi
@output         -> Cikti ortami, format, dosya adi

Opsiyonel Bolumler; icerige gore ekle:
@memory         -> Oturumlar arasi hafiza veya baglam yonetimi
@tone           -> Ton, uslup, dil kurallari
@personas       -> Cok-ajan sistemlerde her ajanin rolu
@tools          -> Kullanilacak araclar; web search, code exec vb.
@constraints    -> Butce, sure, token veya kaynak kisitlari

@skill_anatomy
Her @skills blogundaki yetenek su yapida tanimlanir:
SKILL: [skill-name]
- Ne yapar   : Tek cumleyle aciklama
- Requires   : Bagimli oldugu skill; yoksa None
- Input      : Ne alir
- Output     : Ne uretir; format veya sema dahil
- Adimlar    :
  0. On kontrol veya tespit adimi; varsa
  1. Birinci adim
  2. Ikinci adim
- Edge cases :
  - [Durum] -> [Yapilacak]
  - [Durum] -> [Yapilacak]

Kurallar:
- Her skill tek sorumluluk ilkesine uyar; bir is yapar.
- Skill'ler bagimlilik zincirine gore siralanir.
- JSON ciktisi varsa sema ornekle gosterilir.
- Edge case'ler atlanmaz; her skill en az 2 edge case icerir.

@task
1. Kullanicinin istegini oku.
   - Acik istek: Dogrudan uret.
   - Muglak istek: Tek bir soru sor, cevabi bekle, sonra uret.
   - Cok kisa istek; 1-2 kelime: @clarification_questions setini kullan.
2. Istegi asagidaki boyutlarda analiz et:
   - Arac mi, ajan mi, is akisi mi, asistan mi?
   - Tek adimli mi, cok adimli mi?
   - Cikti formati nedir? HTML, JSON, metin, kod, rapor vb.
   - Hedef kitle kim?
   - Guvenlik veya uyumluluk gereksinimleri var mi?
   - Hangi ortamda calisacak? chat, API, kod ortami, agent pipeline vb.
3. @spf_standard yapisina gore eksiksiz bir prompt uret.
4. Her bolumu doldur. Hicbir bolumu atlama veya "gerekirse ekleyin" gibi tamamlanmamis notlar birakma.
5. Urettikten sonra, promptun altina kisa bir "Tasarim Kararlari" ozeti ekle:
   - Hangi varsayimlari yaptin ve neden
   - Hangi guvenlik ve kalite risklerini onden kapattin
   - Kullanicinin ozellestirmek isteyebilecegi 2-3 alan

@clarification_questions
Kullanicinin istegi cok kisa veya muglaksa yalnizca su sorulari sor; hepsini birden, tek mesajda:
Promptu uretmek icin birkac bilgiye ihtiyacim var:

1. Bu prompt hangi tur yapi icin? arac / ajan / asistan / is akisi / baska
2. Kullanici bu sistemle nasil etkilesir? dosya yukler / mesaj yazar / form doldurur / otomatik tetiklenir
3. Cikti ne olacak? HTML rapor / JSON / metin / kod / baska
4. Hedef kitle kim? gelistirici / son kullanici / sirket ici ekip / baska
5. Ozellikle hassas veya riskli bir alan var mi? hukuk / tip / finans / egitim / baska

Bu sorulari sorduktan sonra cevabi bekle. Cevap gelmeden uretme.

@quality_rules
Her urettigin promptta su kalite standartlarini zorunlu uygula:
Guvenlik:
- Hassas veri isliyorsa; kisisel, tibbi, hukuki, finansal: @init icine gizlilik uyarisi ekle.
- Sonuc garantisi iceren ciktilar; olasilik, tahmin, skor: altina disclaimer ekle.
- URL veya link uretilecekse: hallusinasyon engelleyici kural ekle; uydurma yasak, bilinmiyorsa null kullan.
- Kullaniciya zarar verebilecek tavsiye ciktilari varsa: "Uzman gorusu alin" notu ekle.

Tutarsizlik Kontrolu:
- @rules icindeki yasaklar @task adimlariyla celismesin.
- @validators icindeki her kural gercekten dogrulanabilir olsun.
- @failure_policy @validators ile cakismasin; biri "zorunlu" derken digeri "atla" demesin.
- @output ortami @task cikti adimiyla tutarli olsun.

Tamlik:
- Her skill'in en az 2 edge case'i olsun.
- @validators checkbox formatinda, somut ve olculebilir olsun.
- @failure_policy her hata turunu kapsasin.
- @sections her bolumde id attribute'u icersin; navigasyon icin.

Dil:
- Prompt Turkce istenmedikce Ingilizce uret.
- Teknik terimler tutarli kullanilsin; skill adlari ve field adlari degismesin.
- "Gerekirse", "istege bagli olarak", "TODO" ifadeleri kullanilmasin.

@output_format
Uretilen SPF promptu su formatta sun:
# [Arac/Sistem Adi] -- Sistem Promptu v1.0

---
[Tum @bolumler sirayla]
---

## Tasarim Kararlari

**Varsayimlar:**
- [Varsayim 1 ve gerekcesi]
- [Varsayim 2 ve gerekcesi]

**Kapatilan Riskler:**
- [Risk 1 ve nasil kapatildigi]
- [Risk 2 ve nasil kapatildigi]

**Ozellestirme Onerileri:**
- [Alan 1]: [Neden ozellestirilebilir]
- [Alan 2]: [Neden ozellestirilebilir]

@rules
- Kullanici ne kadar kisa istek yazarsa yazsin, uretilen prompt eksiksiz olmalidir.
- "Eklenebilir", "gelistirilebilir", "TODO" gibi ifadeler kesinlikle kullanilmaz.
- Her validator somut ve binary true/false olmalidir; "iyi gorunuyor" gibi subjektif ifade yok.
- Skill bagimliliklari; Requires; dogru tanimlanmali, dongusel bagimlilik olmamalidir.
- Ayni promptu iki kez uretme; her uretimde kullanim senaryosuna ozel detaylar bulunmalidir.
- Uretim sonrasi "Tasarim Kararlari" bolumunu atlamak yasaktir.
- Guvenlik kurallari icerige gore dinamik eklenir; kopyala-yapistir sablon kullanilmaz.

@validators
- [ ] spf_all_mandatory_sections_present -> @model'den @output'a tum zorunlu bolumler var.
- [ ] no_todo_or_placeholder -> "TODO", "gerekirse", bos alan yok.
- [ ] skill_chain_valid -> Skill bagimliliklari dongusuz ve sirali.
- [ ] validators_are_binary -> Her validator true/false olculebilir.
- [ ] failure_policy_covers_all_errors -> Her hata turu ele alinmis.
- [ ] security_rules_context_appropriate -> Guvenlik kurallari icerige ozgu.
- [ ] design_decisions_section_present -> Tasarim Kararlari bolumu mevcut.
- [ ] output_environment_consistent -> @output ve @task ortami tutarli.

@failure_policy
- Kullanici istegi anlasilamiyorsa -> @clarification_questions setini kullan, uretme.
- Uretim sirasinda bir bolum doldurulamiyorsa -> O bolumu makul varsayimla doldur, Tasarim Kararlari'nda belirt.
- Guvenlik riski tespit edilirse -> Kurali promptun icine gom, Tasarim Kararlari'nda acikla.
- Kullanici "kisa tut" derse -> Tum bolumleri koru, icerik yogunlugunu azalt; bolum atlama.

@output
Ciktiyi dogrudan chat'e yaz; artifact veya kod blogu icinde.
Markdown formatinda, kopyalanabilir sekilde sun.
Dosya olarak istenmisse: [sistem_adi]_prompt.md olarak kaydet.`;

const ANALYSIS_SYSTEM_PROMPT = `ROLE: You are a senior prompt QA analyst for SPF prompts.
Return only valid JSON. Do not use markdown. Do not include prose outside JSON.
Focus on missing context, prompt quality, and practical test cases.`;

const REVISION_SYSTEM_PROMPT = `ROLE: You are an expert SPF prompt editor.
You revise existing SPF prompts without changing their required section contract.
Return only the complete revised SPF prompt. No explanation before or after.`;

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

function getInitials(value = '') {
  const parts = String(value).trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return 'SP';
  return parts
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');
}

function renderAvatarMarkup({ imageClass, fallbackClass, wrapperClass, name, avatarUrl }) {
  const safeName = escapeHtml(name || 'Profil');
  const safeAvatarUrl = escapeHtml(avatarUrl || '');
  const initials = escapeHtml(getInitials(name));
  const hiddenAttr = safeAvatarUrl ? '' : ' hidden';

  return `<span class="${wrapperClass}">
    <img class="${imageClass}" src="${safeAvatarUrl}" alt="${safeName}"${hiddenAttr} onerror="this.hidden=true;this.nextElementSibling.hidden=false;">
    <span class="${fallbackClass}"${safeAvatarUrl ? ' hidden' : ''}>${initials}</span>
  </span>`;
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

async function requireAdmin(req, res, next) {
  if (!req.isAuthenticated()) {
    if (req.path.startsWith('/api/')) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    return res.redirect('/login');
  }

  try {
    await hydrateAuthenticatedUser(req);
    if (isAdminUser(req.user, configuredAdminEmails)) return next();
    if (req.path.startsWith('/api/')) {
      return res.status(403).json({ error: 'Admin access required' });
    }
    return res.redirect('/profile');
  } catch (error) {
    return handleError(res, error);
  }
}

function ensureSupabaseAdmin() {
  if (!supabaseAdmin) {
    throw Object.assign(new Error('Supabase configuration is missing.'), { status: 500 });
  }
  if (supabaseAdminDisabledReason) {
    throw Object.assign(new Error(supabaseAdminDisabledReason), { status: 503 });
  }
  return supabaseAdmin;
}

function disableSupabaseAdmin(error) {
  const message = error?.message || '';
  if (!message.includes('Invalid API key')) return;
  supabaseAdminDisabledReason = 'Supabase service key is invalid.';
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
  if (isAdminUser(profileUser, configuredAdminEmails)) {
    payload.is_admin = true;
  }

  const { data, error } = await client
    .from('users')
    .upsert(payload, { onConflict: 'google_id' })
    .select('id, google_id, email, name, avatar_url, last_login, is_admin, is_blocked, block_reason, daily_prompt_limit, daily_revision_limit, daily_analysis_limit, admin_notes')
    .single();

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  return data;
}

async function hydrateAuthenticatedUser(req) {
  if (
    !req.isAuthenticated?.() ||
    (
      req.user?.id &&
      typeof req.user?.is_admin !== 'undefined' &&
      typeof req.user?.is_blocked !== 'undefined'
    ) ||
    !req.user?.google_id ||
    !isSupabaseAdminAvailable()
  ) {
    return req.user;
  }

  const userRecord = await syncGoogleUser(req.user);
  req.user = { ...req.user, ...userRecord, db_sync_error: null };

  if (req.session?.passport) {
    req.session.passport.user = req.user;
  }

  return req.user;
}

async function fetchUserPrompts(userId) {
  const blocker = getPromptPersistenceBlocker({
    userId,
    supabaseAdminAvailable: isSupabaseAdminAvailable(),
    disabledReason: supabaseAdminDisabledReason,
  });
  if (blocker) {
    throw Object.assign(new Error(blocker.message), {
      status: blocker.code === 'missing_user_id' ? 401 : 503,
      code: blocker.code,
    });
  }

  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('prompts')
    .select('id, task, generated_prompt, created_at')
    .eq('user_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  return data || [];
}

async function fetchUserContextPacks(userId) {
  if (!userId || !isSupabaseAdminAvailable()) return [];
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('context_packs')
    .select('id, name, description, content, created_at, updated_at')
    .eq('user_id', userId)
    .order('updated_at', { ascending: false });

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  return data || [];
}

async function fetchUserContextPack(userId, contextPackId) {
  if (!userId || !contextPackId || !isSupabaseAdminAvailable()) return null;
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('context_packs')
    .select('id, name, description, content, created_at, updated_at')
    .eq('id', contextPackId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  return data || null;
}

async function fetchPromptForUser(userId, promptId) {
  if (!userId || !promptId || !isSupabaseAdminAvailable()) return null;
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('prompts')
    .select('id, task, generated_prompt, created_at')
    .eq('id', promptId)
    .eq('user_id', userId)
    .maybeSingle();

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  return data || null;
}

async function fetchPromptVersionsForUser(userId, promptId) {
  const prompt = await fetchPromptForUser(userId, promptId);
  if (!prompt) return null;

  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('prompt_versions')
    .select('id, prompt_id, version_number, generated_prompt, revision_instruction, context_pack_snapshot, missing_context, quality_report, test_package, created_at')
    .eq('prompt_id', promptId)
    .order('version_number', { ascending: false });

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }

  return { prompt, versions: data || [] };
}

async function fetchMarketItem(itemId) {
  if (!itemId || !isSupabaseAdminAvailable()) return null;
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('prompt_market_items')
    .select('id, prompt_id, user_id, title, description, category, prompt_text, source_task, star_count, comment_count, save_count, usage_count, is_active, created_at, updated_at')
    .eq('id', itemId)
    .eq('is_active', true)
    .maybeSingle();

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  return data || null;
}

async function refreshMarketCounts(itemId) {
  const client = ensureSupabaseAdmin();
  const [starsResult, savesResult, commentsResult] = await Promise.all([
    client.from('prompt_market_stars').select('id', { count: 'exact', head: true }).eq('market_item_id', itemId),
    client.from('prompt_market_saves').select('id', { count: 'exact', head: true }).eq('market_item_id', itemId),
    client.from('prompt_market_comments').select('id', { count: 'exact', head: true }).eq('market_item_id', itemId),
  ]);

  const failed = [starsResult, savesResult, commentsResult].find((result) => result.error);
  if (failed?.error) {
    disableSupabaseAdmin(failed.error);
    throw failed.error;
  }

  const { data, error } = await client
    .from('prompt_market_items')
    .update({
      star_count: starsResult.count || 0,
      save_count: savesResult.count || 0,
      comment_count: commentsResult.count || 0,
      updated_at: new Date().toISOString(),
    })
    .eq('id', itemId)
    .select('id, prompt_id, user_id, title, description, category, prompt_text, source_task, star_count, comment_count, save_count, usage_count, is_active, created_at, updated_at')
    .single();

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  return data;
}

async function fetchMarketItemsForUser(userId, filters = {}) {
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('prompt_market_items')
    .select('id, prompt_id, user_id, title, description, category, prompt_text, source_task, star_count, comment_count, save_count, usage_count, is_active, created_at, updated_at')
    .eq('is_active', true)
    .limit(200);

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }

  const query = String(filters.query || '').trim().toLowerCase();
  const category = String(filters.category || '').trim().toLowerCase();
  const visibleItems = (data || []).filter((item) => {
    const matchesCategory = !category || String(item.category || '').toLowerCase() === category;
    const haystack = `${item.title || ''} ${item.description || ''} ${item.category || ''} ${item.source_task || ''}`.toLowerCase();
    return matchesCategory && (!query || haystack.includes(query));
  });
  const ids = visibleItems.map((item) => item.id);
  const authorIds = [...new Set(visibleItems.map((item) => item.user_id).filter(Boolean))];

  const [starsResult, savesResult, authorsResult] = await Promise.all([
    ids.length
      ? client.from('prompt_market_stars').select('market_item_id').eq('user_id', userId).in('market_item_id', ids)
      : Promise.resolve({ data: [], error: null }),
    ids.length
      ? client.from('prompt_market_saves').select('market_item_id').eq('user_id', userId).in('market_item_id', ids)
      : Promise.resolve({ data: [], error: null }),
    authorIds.length
      ? client.from('users').select('id, email, name').in('id', authorIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const failed = [starsResult, savesResult, authorsResult].find((result) => result.error);
  if (failed?.error) {
    disableSupabaseAdmin(failed.error);
    throw failed.error;
  }

  const authorsById = new Map((authorsResult.data || []).map((user) => [user.id, user]));
  const withAuthors = visibleItems.map((item) => {
    const author = authorsById.get(item.user_id);
    return {
      ...item,
      author_name: author?.name || null,
      author_email: author?.email || null,
    };
  });

  return rankMarketItems(applyMarketUserState(
    withAuthors,
    starsResult.data || [],
    savesResult.data || [],
  ));
}

async function fetchMarketComments(itemId) {
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('prompt_market_comments')
    .select('id, market_item_id, user_id, body, created_at')
    .eq('market_item_id', itemId)
    .order('created_at', { ascending: false })
    .limit(100);

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }

  const userIds = [...new Set((data || []).map((comment) => comment.user_id).filter(Boolean))];
  const usersResult = userIds.length
    ? await client.from('users').select('id, email, name').in('id', userIds)
    : { data: [], error: null };
  if (usersResult.error) {
    disableSupabaseAdmin(usersResult.error);
    throw usersResult.error;
  }

  const usersById = new Map((usersResult.data || []).map((user) => [user.id, user]));
  return (data || []).map((comment) => {
    const user = usersById.get(comment.user_id);
    return {
      ...comment,
      user_name: user?.name || null,
      user_email: user?.email || null,
    };
  });
}

async function createPromptVersion({
  promptId,
  versionNumber,
  generatedPrompt,
  revisionInstruction = null,
  contextPack = null,
  analysis = null,
}) {
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('prompt_versions')
    .insert({
      prompt_id: promptId,
      version_number: versionNumber,
      generated_prompt: generatedPrompt,
      revision_instruction: revisionInstruction,
      context_pack_snapshot: contextPack,
      missing_context: analysis?.missing_context || [],
      quality_report: {
        score: analysis?.quality_score ?? null,
        findings: analysis?.quality_findings || [],
      },
      test_package: analysis?.test_cases || [],
    })
    .select('id, prompt_id, version_number, generated_prompt, revision_instruction, context_pack_snapshot, missing_context, quality_report, test_package, created_at')
    .single();

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  return data;
}

async function fetchCreditBalance(userId) {
  if (!userId) return 0;
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('credit_transactions')
    .select('delta')
    .eq('user_id', userId);

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }

  return (data || []).reduce((total, transaction) => total + Number(transaction.delta || 0), 0);
}

async function ensureFreeCredits(userId) {
  if (!userId) {
    throw Object.assign(new Error('Authentication required'), { status: 401 });
  }

  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('credit_transactions')
    .select('id')
    .eq('user_id', userId)
    .eq('reason', 'signup_bonus')
    .maybeSingle();

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }

  if (data?.id) return;

  const freePackage = getCreditPackage('free');
  const { error: insertError } = await client
    .from('credit_transactions')
    .insert({
      user_id: userId,
      delta: freePackage.credits,
      reason: 'signup_bonus',
      package_id: freePackage.id,
      description: 'Free baslangic kredisi',
    });

  if (insertError && insertError.code !== '23505') {
    disableSupabaseAdmin(insertError);
    throw insertError;
  }
}

async function getCreditSummary(userId) {
  await ensureFreeCredits(userId);
  const balance = await fetchCreditBalance(userId);
  return {
    balance,
    costs: CREDIT_COSTS,
    packages: CREDIT_PACKAGES,
  };
}

async function assertEnoughCredits(userId, action) {
  await ensureFreeCredits(userId);
  const balance = await fetchCreditBalance(userId);
  const cost = getCreditCost(action);

  if (!canSpendCredits(balance, cost)) {
    throw Object.assign(
      new Error(`Yetersiz kredi. Bu islem ${cost} kredi gerektirir. Mevcut kredi: ${balance}.`),
      {
        status: 402,
        credits_required: cost,
        credits_balance: balance,
      },
    );
  }

  return { balance, cost };
}

async function spendCredits(userId, action, reference = {}) {
  const cost = getCreditCost(action);
  const client = ensureSupabaseAdmin();
  const { error } = await client
    .from('credit_transactions')
    .insert({
      user_id: userId,
      delta: -cost,
      reason: action,
      reference_type: reference.type || null,
      reference_id: reference.id || null,
      description: reference.description || null,
    });

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }

  return fetchCreditBalance(userId);
}

async function fetchAdminDataset() {
  const client = ensureSupabaseAdmin();
  const [
    usersResult,
    promptsResult,
    versionsResult,
    creditsResult,
    announcementsResult,
    campaignsResult,
    auditLogsResult,
  ] = await Promise.all([
    client
      .from('users')
      .select('id, google_id, email, name, avatar_url, created_at, last_login, is_admin, is_blocked, block_reason, blocked_at, daily_prompt_limit, daily_revision_limit, daily_analysis_limit, admin_notes')
      .order('created_at', { ascending: false })
      .limit(5000),
    client
      .from('prompts')
      .select('id, user_id, task, created_at')
      .order('created_at', { ascending: false })
      .limit(10000),
    client
      .from('prompt_versions')
      .select('id, prompt_id, version_number, revision_instruction, created_at')
      .order('created_at', { ascending: false })
      .limit(10000),
    client
      .from('credit_transactions')
      .select('id, user_id, delta, reason, reference_type, reference_id, package_id, description, created_at')
      .order('created_at', { ascending: false })
      .limit(10000),
    client
      .from('announcements')
      .select('id, title, body, severity, status, starts_at, ends_at, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    client
      .from('campaigns')
      .select('id, name, code, description, credit_bonus, starts_at, ends_at, max_redemptions, redeemed_count, is_active, created_by, created_at, updated_at')
      .order('created_at', { ascending: false })
      .limit(1000),
    client
      .from('admin_audit_logs')
      .select('id, admin_user_id, action, target_type, target_id, details, created_at')
      .order('created_at', { ascending: false })
      .limit(1000),
  ]);

  const failed = [
    usersResult,
    promptsResult,
    versionsResult,
    creditsResult,
    announcementsResult,
    campaignsResult,
    auditLogsResult,
  ].find((result) => result.error);
  if (failed?.error) {
    disableSupabaseAdmin(failed.error);
    throw failed.error;
  }

  return {
    users: usersResult.data || [],
    prompts: promptsResult.data || [],
    promptVersions: versionsResult.data || [],
    creditTransactions: creditsResult.data || [],
    announcements: announcementsResult.data || [],
    campaigns: campaignsResult.data || [],
    auditLogs: auditLogsResult.data || [],
  };
}

async function fetchUserControls(userId) {
  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('users')
    .select('id, email, is_blocked, block_reason, daily_prompt_limit, daily_revision_limit, daily_analysis_limit')
    .eq('id', userId)
    .maybeSingle();

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  return data;
}

async function fetchUserDailyUsage(userId) {
  const client = ensureSupabaseAdmin();
  const since = new Date();
  since.setUTCHours(0, 0, 0, 0);

  const [promptsResult, creditsResult] = await Promise.all([
    client
      .from('prompts')
      .select('id, user_id, created_at')
      .eq('user_id', userId)
      .gte('created_at', since.toISOString())
      .limit(10000),
    client
      .from('credit_transactions')
      .select('id, user_id, reason, created_at')
      .eq('user_id', userId)
      .in('reason', ['revise', 'analyze'])
      .gte('created_at', since.toISOString())
      .limit(10000),
  ]);

  const failed = [promptsResult, creditsResult].find((result) => result.error);
  if (failed?.error) {
    disableSupabaseAdmin(failed.error);
    throw failed.error;
  }

  return getDailyUsageCounts(
    {
      prompts: promptsResult.data || [],
      creditTransactions: creditsResult.data || [],
    },
    userId,
  );
}

async function assertUserActionAllowed(userId, action) {
  const [userControls, usageCounts] = await Promise.all([
    fetchUserControls(userId),
    fetchUserDailyUsage(userId),
  ]);
  const access = evaluateActionAccess(userControls, action, usageCounts);
  if (!access.allowed) {
    throw Object.assign(new Error(access.reason), {
      status: access.status,
      action,
      usage_counts: usageCounts,
    });
  }
}

async function fetchAdminUserRow(userId) {
  const dataset = await fetchAdminDataset();
  return buildAdminUserRows(dataset).find((user) => user.id === userId) || null;
}

async function logAdminAction(adminUserId, action, targetType, targetId, details = {}) {
  if (!adminUserId || !isSupabaseAdminAvailable()) return;
  const client = ensureSupabaseAdmin();
  const { error } = await client
    .from('admin_audit_logs')
    .insert({
      admin_user_id: adminUserId,
      action,
      target_type: targetType,
      target_id: targetId || null,
      details,
    });

  if (error) {
    console.error('Admin audit log skipped:', error.message);
  }
}

async function savePromptIfPossible(userId, task, prompt, contextPack = null) {
  const blocker = getPromptPersistenceBlocker({
    userId,
    supabaseAdminAvailable: isSupabaseAdminAvailable(),
    disabledReason: supabaseAdminDisabledReason,
  });
  if (blocker) {
    throw Object.assign(new Error(blocker.message), {
      status: blocker.code === 'missing_user_id' ? 401 : 503,
      code: blocker.code,
    });
  }

  const client = ensureSupabaseAdmin();
  const { data, error } = await client
    .from('prompts')
    .insert({
      user_id: userId,
      task,
      generated_prompt: prompt,
    })
    .select('id')
    .single();

  if (error) {
    disableSupabaseAdmin(error);
    throw error;
  }
  const promptId = data?.id || null;
  if (!promptId) return null;

  await createPromptVersion({
    promptId,
    versionNumber: 1,
    generatedPrompt: prompt,
    contextPack,
  });

  return promptId;
}

async function analyzePromptInput(task, contextPack = null) {
  const ai = getGeminiClient();
  const response = await ai.models.generateContent({
    model: getModelName(),
    contents: buildAnalysisPrompt(task, contextPack),
    config: {
      systemInstruction: ANALYSIS_SYSTEM_PROMPT,
    },
  });

  return normalizeAnalysisPayload(parseJsonObject(response.text || '{}'));
}

function getGeminiClient() {
  const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;

  if (apiKey) {
    return new GoogleGenAI({ apiKey });
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

function hasGeminiRuntimeConfig() {
  const apiKey = Boolean(process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY);
  const credentialsPath =
    process.env.GEMINI_SERVICE_ACCOUNT_PATH ||
    process.env.GOOGLE_APPLICATION_CREDENTIALS;
  const hasCredentialFile = credentialsPath ? fs.existsSync(credentialsPath) : false;
  const hasProject = Boolean(process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID);

  return apiKey || hasProject || hasCredentialFile;
}

function getModelName() {
  return (
    process.env.GEMINI_MODEL ||
    process.env.GEMINI_MODEL_NAME ||
    process.env.GEMINI_STABLE_FALLBACK_MODEL_NAME ||
    'gemini-3-pro-preview'
  );
}

function getConfiguredProject() {
  return process.env.GOOGLE_CLOUD_PROJECT || process.env.GOOGLE_PROJECT_ID || 'configured project';
}

function handleError(res, error) {
  const handledError = normalizeMarketSchemaError(error);
  console.error(handledError);
  if (handledError.status === 402) {
    return res.status(402).json({
      error: handledError.message || 'Yetersiz kredi.',
      credits_required: handledError.credits_required,
      credits_balance: handledError.credits_balance,
    });
  }
  if (handledError.status === 429) {
    return res.status(429).json({
      error: handledError.message || 'Gunluk limit doldu.',
      action: handledError.action,
      usage_counts: handledError.usage_counts,
    });
  }
  if (handledError.message?.includes('BILLING_DISABLED') || handledError.message?.includes('requires billing to be enabled')) {
    return res.status(403).json({
      error: `Google Cloud projesinde faturalandirma kapali. Vertex AI/Gemini cagrisi icin ${getConfiguredProject()} projesinde billing etkinlestirilmeli.`,
    });
  }
  if (handledError.message?.includes('aiplatform.endpoints.predict') || handledError.message?.includes('IAM_PERMISSION_DENIED')) {
    return res.status(403).json({
      error: `Servis hesabinda ${getConfiguredProject()} projesi icin Vertex AI predict izni yok. IAM tarafinda Vertex AI User rolunu veya aiplatform.endpoints.predict iznini ekleyin.`,
    });
  }
  if (handledError.status === 401 && handledError.message?.includes('GEMINI_API_KEY or GOOGLE_CLOUD_PROJECT')) {
    return res.status(503).json({
      error: 'Gemini/Vertex AI arka ucu hazir degil. API key veya servis hesabi ayarlarini kontrol edin.',
    });
  }
  if (handledError.status === 401) {
    return res.status(401).json({ error: handledError.message || 'Authentication required' });
  }
  if (handledError.status === 403) {
    return res.status(403).json({ error: handledError.message || 'Forbidden' });
  }
  if (handledError.status === 503) {
    return res.status(503).json({
      error: handledError.message || 'Service unavailable',
      code: handledError.code,
    });
  }
  if (handledError.name === 'AbortError') {
    return res.status(504).json({ error: 'Request timeout' });
  }
  return res.status(handledError.status || 500).json({ error: handledError.message || 'Internal server error' });
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
    .avatar-wrap,
    .profile-avatar-wrap {
      position: relative;
      display: inline-grid;
      place-items: center;
      overflow: hidden;
      border-radius: 50%;
      background: var(--surface2);
      border: 1px solid var(--border);
      flex-shrink: 0;
    }
    .avatar-wrap {
      width: 36px;
      height: 36px;
    }
    .profile-avatar-wrap {
      width: 72px;
      height: 72px;
    }
    .avatar {
      width: 36px;
      height: 36px;
      border-radius: 50%;
      object-fit: cover;
      display: block;
    }
    .avatar-fallback,
    .profile-avatar-fallback {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 100%;
      height: 100%;
      font-family: "Space Grotesk", sans-serif;
      font-weight: 800;
      color: var(--text-primary);
      background: linear-gradient(135deg, #232334, #151515);
    }
    .avatar-fallback {
      font-size: 12px;
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
    .profile-avatar { width: 72px; height: 72px; border-radius: 50%; object-fit: cover; display: block; }
    .profile-avatar-fallback { font-size: 24px; }
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
    <script src="/auth-ui.js" defer></script>
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
                ${renderAvatarMarkup({
                  wrapperClass: 'avatar-wrap',
                  imageClass: 'avatar',
                  fallbackClass: 'avatar-fallback',
                  name: user?.name || 'Kullanıcı',
                  avatarUrl: user?.avatar_url || '',
                })}
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
      <p class="subtitle">Görevi yaz, Gemini 3 Pro ile yapılandırılmış, çalıştırılabilir bir SPF prompt al. Ürettiğin promptlar profilinde saklanır.</p>
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
    let runtimeBlocked = false;

    function setStatus(message, isError = false) {
      statusEl.textContent = message;
      statusEl.classList.toggle('error', isError);
    }

    async function ensureAppRuntime() {
      const [sessionResponse, configResponse] = await Promise.all([
        fetch('/api/auth/session', { credentials: 'include' }),
        fetch('/api/auth/config', { credentials: 'include' }),
      ]);

      const session = await sessionResponse.json();
      if (!session.authenticated) {
        window.location.href = '/login';
        return false;
      }

      const config = await configResponse.json();
      if (!config.geminiConfigured) {
        runtimeBlocked = true;
        generateBtn.disabled = true;
        setStatus('Gemini backend ayari eksik. API key veya servis hesabi tanimlanmali.', true);
        return false;
      }

      runtimeBlocked = false;
      generateBtn.disabled = false;
      return true;
    }

    generateBtn.addEventListener('click', async () => {
      const task = taskInput.value.trim();
      if (!task) {
        setStatus('Gorev metni gerekli.', true);
        return;
      }
      if (runtimeBlocked) return;
      generateBtn.disabled = true;
      generateBtn.innerHTML = '<i data-lucide="loader-circle"></i> Uretiliyor';
      lucide.createIcons();
      setStatus('Gemini promptu hazirlaniyor...');

      try {
        const ready = await ensureAppRuntime();
        if (!ready) return;

        const response = await fetch('/api/generate', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({ task })
        });
        const data = await response.json();
        if (response.status === 401) {
          window.location.href = '/login';
          return;
        }
        if (!response.ok) throw new Error(data.error || 'Prompt uretilemedi.');
        promptOutput.value = data.prompt;
        setStatus(data.prompt_id ? 'Prompt uretildi ve profilinize kaydedildi.' : 'Prompt uretildi.');
      } catch (error) {
        setStatus(error.message || 'Beklenmeyen hata olustu.', true);
      } finally {
        generateBtn.disabled = false;
        generateBtn.innerHTML = '<i data-lucide="sparkles"></i> Prompt Uret';
        lucide.createIcons();
      }
    });

    ensureAppRuntime().catch(() => {
      runtimeBlocked = true;
      generateBtn.disabled = true;
      setStatus('Uygulama oturumu dogrulanamadi. Sayfayi yenileyip tekrar giris yapin.', true);
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
        ${renderAvatarMarkup({
          wrapperClass: 'profile-avatar-wrap',
          imageClass: 'profile-avatar',
          fallbackClass: 'profile-avatar-fallback',
          name: user?.name || 'Profil',
          avatarUrl: user?.avatar_url || '',
        })}
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
            is_admin: Boolean(isAdminUser(req.user, configuredAdminEmails)),
            is_blocked: Boolean(req.user.is_blocked),
            block_reason: req.user.block_reason || '',
          }
        : null,
  });
});

app.get('/api/auth/config', (_req, res) => {
  res.json({
    googleOAuthConfigured,
    supabaseConfigured: Boolean(supabaseAdmin),
    geminiConfigured: hasGeminiRuntimeConfig(),
    callbackUrl: configuredGoogleCallbackUrl,
  });
});

app.get('/api/status', async (_req, res) => {
  let promptPersistenceChecked = false;
  let promptPersistenceOk = false;
  let promptPersistenceError = '';
  let promptMarketChecked = false;
  let promptMarketOk = false;
  let promptMarketError = '';

  if (isSupabaseAdminAvailable()) {
    promptPersistenceChecked = true;
    try {
      const { error } = await supabaseAdmin
        .from('prompts')
        .select('id')
        .limit(1);

      if (error) {
        disableSupabaseAdmin(error);
        promptPersistenceError = error.message || 'Supabase prompt persistence check failed.';
      } else {
        promptPersistenceOk = true;
      }
    } catch (error) {
      promptPersistenceError = error?.message || 'Supabase prompt persistence check failed.';
    }

    promptMarketChecked = true;
    try {
      const { error } = await supabaseAdmin
        .from('prompt_market_items')
        .select('id')
        .limit(1);

      if (error) {
        const handledError = normalizeMarketSchemaError(error);
        promptMarketError = handledError.message || 'Prompt Market schema check failed.';
      } else {
        promptMarketOk = true;
      }
    } catch (error) {
      const handledError = normalizeMarketSchemaError(error);
      promptMarketError = handledError?.message || 'Prompt Market schema check failed.';
    }
  } else {
    promptPersistenceError =
      supabaseAdminDisabledReason ||
      (supabaseAdmin ? 'Supabase prompt persistence is unavailable.' : 'Supabase configuration is missing.');
    promptMarketError = promptPersistenceError;
  }

  const status = buildRuntimeStatus({
    googleOAuthConfigured,
    googleCallbackUrl: configuredGoogleCallbackUrl,
    geminiConfigured: hasGeminiRuntimeConfig(),
    geminiModel: getModelName(),
    supabaseConfigured: Boolean(supabaseAdmin),
    supabaseAdminAvailable: isSupabaseAdminAvailable(),
    supabaseDisabledReason: supabaseAdminDisabledReason,
    promptPersistenceChecked,
    promptPersistenceOk,
    promptPersistenceError,
    promptMarketChecked,
    promptMarketOk,
    promptMarketError,
  });

  return res.status(status.ok ? 200 : 503).json(status);
});

app.get('/api/credits', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const summary = await getCreditSummary(req.user.id);
    return res.json(summary);
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/credits/checkout', requireAuth, async (req, res) => {
  try {
    const packageId = typeof req.body?.package_id === 'string' ? req.body.package_id : '';
    const creditPackage = getCreditPackage(packageId);
    if (!creditPackage) return res.status(400).json({ error: 'Credit package not found' });

    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const summary = await getCreditSummary(req.user.id);
    return res.json({
      ...summary,
      package: creditPackage,
      checkout_url: null,
      payment_required: creditPackage.price_cents > 0,
      message:
        creditPackage.price_cents > 0
          ? 'Odeme saglayici henuz bagli degil. Stripe veya Lemon Squeezy baglaninca bu paket otomatik kredi yukler.'
          : 'Free kredi paketi hesabiniza otomatik tanimlanir.',
    });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/admin/overview', requireAdmin, async (_req, res) => {
  try {
    const dataset = await fetchAdminDataset();
    const userRows = buildAdminUserRows(dataset);
    return res.json({
      overview: buildAdminOverview(dataset),
      recent_users: userRows.slice(0, 8),
      recent_credit_transactions: buildAdminCreditTransactionRows(
        dataset.creditTransactions.slice(0, 20),
        dataset.users,
      ),
      announcements: dataset.announcements,
      campaigns: dataset.campaigns,
      audit_logs: dataset.auditLogs.slice(0, 30),
    });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/admin/users', requireAdmin, async (_req, res) => {
  try {
    const dataset = await fetchAdminDataset();
    return res.json({ users: buildAdminUserRows(dataset) });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/admin/users/:id/credits', requireAdmin, async (req, res) => {
  try {
    const delta = Number(req.body?.delta);
    const description =
      typeof req.body?.description === 'string'
        ? req.body.description.trim()
        : '';

    if (!Number.isInteger(delta) || delta === 0 || Math.abs(delta) > 100000) {
      return res.status(400).json({ error: 'Credit delta must be a non-zero integer up to 100000.' });
    }

    const client = ensureSupabaseAdmin();
    const { data: targetUser, error: userError } = await client
      .from('users')
      .select('id')
      .eq('id', req.params.id)
      .maybeSingle();
    if (userError) throw userError;
    if (!targetUser) return res.status(404).json({ error: 'User not found' });

    const { error } = await client
      .from('credit_transactions')
      .insert({
        user_id: req.params.id,
        delta,
        reason: 'admin_adjustment',
        reference_type: 'admin_user',
        reference_id: req.user.id || null,
        description: description || `Admin adjustment by ${req.user.email}`,
      });

    if (error) throw error;
    await logAdminAction(req.user.id, 'credit_adjustment', 'user', req.params.id, { delta, description });
    const user = await fetchAdminUserRow(req.params.id);
    return res.json({ user });
  } catch (error) {
    return handleError(res, error);
  }
});

app.patch('/api/admin/users/:id', requireAdmin, async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body?.is_admin === 'boolean') updates.is_admin = req.body.is_admin;
    if (
      'is_blocked' in req.body ||
      'block_reason' in req.body ||
      'admin_notes' in req.body ||
      'daily_prompt_limit' in req.body ||
      'daily_revision_limit' in req.body ||
      'daily_analysis_limit' in req.body
    ) {
      Object.assign(updates, normalizeUserControls(req.body));
      updates.blocked_at = updates.is_blocked ? new Date().toISOString() : null;
      if (!updates.is_blocked) updates.block_reason = '';
    }

    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('users')
      .update(updates)
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'User not found' });
    await logAdminAction(req.user.id, 'user_update', 'user', req.params.id, updates);
    const user = await fetchAdminUserRow(req.params.id);
    return res.json({ user });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/admin/announcements', requireAdmin, async (_req, res) => {
  try {
    const dataset = await fetchAdminDataset();
    return res.json({ announcements: dataset.announcements });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/admin/announcements', requireAdmin, async (req, res) => {
  try {
    const title = typeof req.body?.title === 'string' ? req.body.title.trim() : '';
    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    const severity = typeof req.body?.severity === 'string' ? req.body.severity : 'info';
    const status = typeof req.body?.status === 'string' ? req.body.status : 'draft';
    if (!title || !body) return res.status(400).json({ error: 'Title and body are required' });

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('announcements')
      .insert({
        title,
        body,
        severity,
        status,
        starts_at: req.body?.starts_at || null,
        ends_at: req.body?.ends_at || null,
        created_by: req.user.id,
      })
      .select('id, title, body, severity, status, starts_at, ends_at, created_by, created_at, updated_at')
      .single();

    if (error) throw error;
    await logAdminAction(req.user.id, 'announcement_create', 'announcement', data.id, { title, status });
    return res.status(201).json({ announcement: data });
  } catch (error) {
    return handleError(res, error);
  }
});

app.patch('/api/admin/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const updates = {};
    for (const key of ['title', 'body', 'severity', 'status', 'starts_at', 'ends_at']) {
      if (key in req.body) updates[key] = typeof req.body[key] === 'string' ? req.body[key].trim() || null : req.body[key];
    }
    updates.updated_at = new Date().toISOString();

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('announcements')
      .update(updates)
      .eq('id', req.params.id)
      .select('id, title, body, severity, status, starts_at, ends_at, created_by, created_at, updated_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Announcement not found' });
    await logAdminAction(req.user.id, 'announcement_update', 'announcement', req.params.id, updates);
    return res.json({ announcement: data });
  } catch (error) {
    return handleError(res, error);
  }
});

app.delete('/api/admin/announcements/:id', requireAdmin, async (req, res) => {
  try {
    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('announcements')
      .delete()
      .eq('id', req.params.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Announcement not found' });
    await logAdminAction(req.user.id, 'announcement_delete', 'announcement', req.params.id);
    return res.json({ ok: true });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/admin/campaigns', requireAdmin, async (_req, res) => {
  try {
    const dataset = await fetchAdminDataset();
    return res.json({ campaigns: dataset.campaigns });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/admin/campaigns', requireAdmin, async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const code = typeof req.body?.code === 'string' ? req.body.code.trim().toUpperCase() : '';
    const creditBonus = Number(req.body?.credit_bonus || 0);
    if (!name || !code || !Number.isInteger(creditBonus) || creditBonus < 0) {
      return res.status(400).json({ error: 'Name, code, and non-negative credit bonus are required' });
    }

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('campaigns')
      .insert({
        name,
        code,
        description: typeof req.body?.description === 'string' ? req.body.description.trim() : '',
        credit_bonus: creditBonus,
        starts_at: req.body?.starts_at || null,
        ends_at: req.body?.ends_at || null,
        max_redemptions: Number.isInteger(Number(req.body?.max_redemptions))
          ? Number(req.body.max_redemptions)
          : null,
        is_active: Boolean(req.body?.is_active),
        created_by: req.user.id,
      })
      .select('id, name, code, description, credit_bonus, starts_at, ends_at, max_redemptions, redeemed_count, is_active, created_by, created_at, updated_at')
      .single();

    if (error) throw error;
    await logAdminAction(req.user.id, 'campaign_create', 'campaign', data.id, { code, creditBonus });
    return res.status(201).json({ campaign: data });
  } catch (error) {
    return handleError(res, error);
  }
});

app.patch('/api/admin/campaigns/:id', requireAdmin, async (req, res) => {
  try {
    const updates = {};
    for (const key of ['name', 'code', 'description', 'starts_at', 'ends_at']) {
      if (key in req.body) updates[key] = typeof req.body[key] === 'string' ? req.body[key].trim() || null : req.body[key];
    }
    if ('code' in updates && updates.code) updates.code = updates.code.toUpperCase();
    if ('credit_bonus' in req.body) updates.credit_bonus = Number(req.body.credit_bonus);
    if ('max_redemptions' in req.body) {
      updates.max_redemptions = req.body.max_redemptions === null || req.body.max_redemptions === ''
        ? null
        : Number(req.body.max_redemptions);
    }
    if ('is_active' in req.body) updates.is_active = Boolean(req.body.is_active);
    updates.updated_at = new Date().toISOString();

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('campaigns')
      .update(updates)
      .eq('id', req.params.id)
      .select('id, name, code, description, credit_bonus, starts_at, ends_at, max_redemptions, redeemed_count, is_active, created_by, created_at, updated_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Campaign not found' });
    await logAdminAction(req.user.id, 'campaign_update', 'campaign', req.params.id, updates);
    return res.json({ campaign: data });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/announcements', requireAuth, async (_req, res) => {
  try {
    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('announcements')
      .select('id, title, body, severity, status, starts_at, ends_at, created_at')
      .order('created_at', { ascending: false })
      .limit(20);

    if (error) throw error;
    return res.json({ announcements: buildActiveRecords(data || []) });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/generate', requireAuth, async (req, res) => {
  try {
    const { task, context_pack_id: contextPackId } = req.body;
    if (!task || typeof task !== 'string' || !task.trim()) {
      return res.status(400).json({ error: 'Task is required' });
    }

    await hydrateAuthenticatedUser(req);
    await assertUserActionAllowed(req.user?.id, 'generate');
    await assertEnoughCredits(req.user?.id, 'generate');
    const contextPack = contextPackId
      ? await fetchUserContextPack(req.user?.id, contextPackId)
      : null;

    if (contextPackId && !contextPack) {
      return res.status(404).json({ error: 'Context pack not found' });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: getModelName(),
      contents: buildTaskWithContext(task, contextPack),
      config: {
        systemInstruction: STRUCTURED_SYSTEM_PROMPT,
      },
    });

    const prompt = response.text || '';
    let promptId = null;

    try {
      promptId = await savePromptIfPossible(req.user?.id, task.trim(), prompt, contextPack);
    } catch (saveError) {
      console.error('Prompt save skipped:', {
        message: saveError?.message,
        code: saveError?.code,
        status: saveError?.status,
      });
      return res.status(saveError?.status === 401 ? 424 : 503).json({
        ...normalizeSaveFailure(prompt, saveError),
        error: 'Prompt generated, but it could not be saved to your profile.',
      });
    }

    const creditsBalance = await spendCredits(req.user.id, 'generate', {
      type: 'prompt',
      id: promptId,
      description: 'Prompt uretimi',
    });

    return res.json({ prompt, prompt_id: promptId, credits_balance: creditsBalance });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/prompts/analyze', requireAuth, async (req, res) => {
  try {
    const { task, context_pack_id: contextPackId } = req.body;
    if (!task || typeof task !== 'string' || !task.trim()) {
      return res.status(400).json({ error: 'Task is required' });
    }

    await hydrateAuthenticatedUser(req);
    await assertUserActionAllowed(req.user?.id, 'analyze');
    await assertEnoughCredits(req.user?.id, 'analyze');
    const contextPack = contextPackId
      ? await fetchUserContextPack(req.user?.id, contextPackId)
      : null;

    if (contextPackId && !contextPack) {
      return res.status(404).json({ error: 'Context pack not found' });
    }

    const analysis = await analyzePromptInput(task.trim(), contextPack);
    const creditsBalance = await spendCredits(req.user.id, 'analyze', {
      type: 'prompt_analysis',
      description: 'Eksik baglam analizi',
    });
    return res.json({ analysis, credits_balance: creditsBalance });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/context-packs', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    const contextPacks = await fetchUserContextPacks(req.user?.id);
    return res.json({ context_packs: contextPacks });
  } catch (error) {
    if (supabaseAdminDisabledReason) {
      return res.json({ context_packs: [] });
    }
    return handleError(res, error);
  }
});

app.post('/api/context-packs', requireAuth, async (req, res) => {
  try {
    const name = typeof req.body?.name === 'string' ? req.body.name.trim() : '';
    const description = typeof req.body?.description === 'string' ? req.body.description.trim() : '';
    const contentInput = typeof req.body?.content === 'string' ? req.body.content.trim() : '';
    const content = contentInput || description;

    if (!name) return res.status(400).json({ error: 'Name is required' });
    if (!content) return res.status(400).json({ error: 'Content is required' });

    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('context_packs')
      .insert({
        user_id: req.user.id,
        name,
        description,
        content,
      })
      .select('id, name, description, content, created_at, updated_at')
      .single();

    if (error) throw error;
    return res.status(201).json({ context_pack: data });
  } catch (error) {
    return handleError(res, error);
  }
});

app.patch('/api/context-packs/:id', requireAuth, async (req, res) => {
  try {
    const updates = {};
    if (typeof req.body?.name === 'string') updates.name = req.body.name.trim();
    if (typeof req.body?.description === 'string') updates.description = req.body.description.trim();
    if (typeof req.body?.content === 'string') updates.content = req.body.content.trim();
    if ('content' in updates && !updates.content && typeof req.body?.description === 'string') {
      updates.content = req.body.description.trim();
    }

    if ('name' in updates && !updates.name) {
      return res.status(400).json({ error: 'Name is required' });
    }
    if ('content' in updates && !updates.content) {
      return res.status(400).json({ error: 'Content is required' });
    }
    if (!Object.keys(updates).length) {
      return res.status(400).json({ error: 'No updates provided' });
    }

    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('context_packs')
      .update({
        ...updates,
        updated_at: new Date().toISOString(),
      })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('id, name, description, content, created_at, updated_at')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Context pack not found' });
    return res.json({ context_pack: data });
  } catch (error) {
    return handleError(res, error);
  }
});

app.delete('/api/context-packs/:id', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('context_packs')
      .delete()
      .eq('id', req.params.id)
      .eq('user_id', req.user.id)
      .select('id')
      .maybeSingle();

    if (error) throw error;
    if (!data) return res.status(404).json({ error: 'Context pack not found' });
    return res.json({ ok: true });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/market', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const items = await fetchMarketItemsForUser(req.user.id, {
      query: req.query.q,
      category: req.query.category,
    });
    const categories = [...new Set(items.map((item) => item.category).filter(Boolean))].sort((a, b) =>
      String(a).localeCompare(String(b), 'tr'),
    );

    return res.json({ items, categories });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/prompts/:id/share', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(404).json({ error: 'Prompt not found' });

    const prompt = await fetchPromptForUser(req.user.id, req.params.id);
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const input = normalizeMarketShareInput(req.body, prompt);
    if (!input.prompt_text) {
      return res.status(400).json({ error: 'Prompt content is required' });
    }

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('prompt_market_items')
      .upsert(
        {
          prompt_id: prompt.id,
          user_id: req.user.id,
          title: input.title,
          description: input.description,
          category: input.category,
          prompt_text: input.prompt_text,
          source_task: input.source_task,
          is_active: true,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'prompt_id' },
      )
      .select('id, prompt_id, user_id, title, description, category, prompt_text, source_task, star_count, comment_count, save_count, usage_count, is_active, created_at, updated_at')
      .single();

    if (error) throw error;
    return res.status(201).json({ item: data });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/market/:id/star', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const item = await fetchMarketItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Market prompt not found' });

    const client = ensureSupabaseAdmin();
    if (req.body?.starred === false) {
      const { error } = await client
        .from('prompt_market_stars')
        .delete()
        .eq('market_item_id', item.id)
        .eq('user_id', req.user.id);
      if (error) throw error;
    } else {
      const { error } = await client
        .from('prompt_market_stars')
        .upsert({ market_item_id: item.id, user_id: req.user.id }, { onConflict: 'market_item_id,user_id' });
      if (error) throw error;
    }

    const updated = await refreshMarketCounts(item.id);
    return res.json({ item: { ...updated, starred_by_user: req.body?.starred !== false } });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/market/:id/save', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const item = await fetchMarketItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Market prompt not found' });

    const client = ensureSupabaseAdmin();
    if (req.body?.saved === false) {
      const { error } = await client
        .from('prompt_market_saves')
        .delete()
        .eq('market_item_id', item.id)
        .eq('user_id', req.user.id);
      if (error) throw error;
    } else {
      const { error } = await client
        .from('prompt_market_saves')
        .upsert({ market_item_id: item.id, user_id: req.user.id }, { onConflict: 'market_item_id,user_id' });
      if (error) throw error;
    }

    const updated = await refreshMarketCounts(item.id);
    return res.json({ item: { ...updated, saved_by_user: req.body?.saved !== false } });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/market/:id/comments', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    const item = await fetchMarketItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Market prompt not found' });

    const comments = await fetchMarketComments(item.id);
    return res.json({ comments });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/market/:id/comments', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(401).json({ error: 'Authentication required' });

    const item = await fetchMarketItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Market prompt not found' });

    const body = typeof req.body?.body === 'string' ? req.body.body.trim() : '';
    if (!body) return res.status(400).json({ error: 'Comment is required' });
    if (body.length > 1000) return res.status(400).json({ error: 'Comment is too long' });

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('prompt_market_comments')
      .insert({
        market_item_id: item.id,
        user_id: req.user.id,
        body,
      })
      .select('id, market_item_id, user_id, body, created_at')
      .single();

    if (error) throw error;
    const updated = await refreshMarketCounts(item.id);
    return res.status(201).json({
      comment: {
        ...data,
        user_name: req.user.name || null,
        user_email: req.user.email || null,
      },
      item: updated,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/market/:id/use', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    const item = await fetchMarketItem(req.params.id);
    if (!item) return res.status(404).json({ error: 'Market prompt not found' });

    const client = ensureSupabaseAdmin();
    const { data, error } = await client
      .from('prompt_market_items')
      .update({
        usage_count: Number(item.usage_count || 0) + 1,
        updated_at: new Date().toISOString(),
      })
      .eq('id', item.id)
      .select('id, prompt_id, user_id, title, description, category, prompt_text, source_task, star_count, comment_count, save_count, usage_count, is_active, created_at, updated_at')
      .single();

    if (error) throw error;
    return res.json({ item: data, prompt: item.prompt_text });
  } catch (error) {
    return handleError(res, error);
  }
});

app.get('/api/prompts', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    const prompts = await fetchUserPrompts(req.user.id);
    return res.json({ prompts });
  } catch (error) {
    console.error('Prompt list could not be loaded:', {
      message: error?.message,
      code: error?.code,
      status: error?.status,
    });
    return handleError(res, error);
  }
});

app.get('/api/prompts/:id/versions', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(404).json({ error: 'Prompt not found' });

    const result = await fetchPromptVersionsForUser(req.user.id, req.params.id);
    if (!result) return res.status(404).json({ error: 'Prompt not found' });

    return res.json({ prompt: result.prompt, versions: result.versions });
  } catch (error) {
    return handleError(res, error);
  }
});

app.post('/api/prompts/:id/revise', requireAuth, async (req, res) => {
  try {
    const revisionInstruction =
      typeof req.body?.revision_instruction === 'string'
        ? req.body.revision_instruction.trim()
        : '';
    const contextPackId = req.body?.context_pack_id;

    if (!revisionInstruction) {
      return res.status(400).json({ error: 'Revision instruction is required' });
    }

    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) return res.status(404).json({ error: 'Prompt not found' });
    await assertUserActionAllowed(req.user.id, 'revise');
    await assertEnoughCredits(req.user.id, 'revise');

    const prompt = await fetchPromptForUser(req.user.id, req.params.id);
    if (!prompt) return res.status(404).json({ error: 'Prompt not found' });

    const contextPack = contextPackId
      ? await fetchUserContextPack(req.user.id, contextPackId)
      : null;
    if (contextPackId && !contextPack) {
      return res.status(404).json({ error: 'Context pack not found' });
    }

    const ai = getGeminiClient();
    const response = await ai.models.generateContent({
      model: getModelName(),
      contents: buildRevisionPrompt({
        currentPrompt: prompt.generated_prompt,
        revisionInstruction,
        contextPack,
      }),
      config: {
        systemInstruction: REVISION_SYSTEM_PROMPT,
      },
    });
    const revisedPrompt = response.text || '';

    let analysis = null;
    try {
      analysis = await analyzePromptInput(
        `${prompt.task}\n\nSPF PROMPT TO REVIEW:\n${revisedPrompt}`,
        contextPack,
      );
    } catch (analysisError) {
      console.error('Revision analysis skipped:', {
        message: analysisError?.message,
      });
    }

    const versionResult = await fetchPromptVersionsForUser(req.user.id, req.params.id);
    const version = await createPromptVersion({
      promptId: req.params.id,
      versionNumber: getNextVersionNumber(versionResult?.versions || []),
      generatedPrompt: revisedPrompt,
      revisionInstruction,
      contextPack,
      analysis,
    });

    const client = ensureSupabaseAdmin();
    const { error: updateError } = await client
      .from('prompts')
      .update({ generated_prompt: revisedPrompt })
      .eq('id', req.params.id)
      .eq('user_id', req.user.id);

    if (updateError) throw updateError;

    const creditsBalance = await spendCredits(req.user.id, 'revise', {
      type: 'prompt',
      id: req.params.id,
      description: 'Prompt revizyonu',
    });

    return res.json({
      prompt: revisedPrompt,
      version,
      analysis,
      credits_balance: creditsBalance,
    });
  } catch (error) {
    return handleError(res, error);
  }
});

app.delete('/api/prompts/:id', requireAuth, async (req, res) => {
  try {
    await hydrateAuthenticatedUser(req);
    if (!req.user?.id) {
      return res.status(404).json({ error: 'Prompt not found' });
    }
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

app.get('/login', (req, res, next) => {
  if (req.isAuthenticated()) return res.redirect('/profile');
  return renderSpaShell(req, res, next);
});

app.get('/', (req, res) => {
  res.sendFile(path.join(process.cwd(), 'index.html'));
});

app.get('/landing', (req, res) => {
  res.redirect(301, '/');
});

app.get('/app', requireAuth, (req, res, next) => {
  return renderSpaShell(req, res, next);
});

app.get('/market', requireAuth, (req, res, next) => {
  return renderSpaShell(req, res, next);
});

app.get('/admin', requireAdmin, (req, res, next) => {
  return renderSpaShell(req, res, next);
});

app.get('/profile', requireAuth, (req, res, next) => {
  return renderSpaShell(req, res, next);
});

app.listen(port, '0.0.0.0', () => {
  console.log(`Server running on http://localhost:${port}`);
});
