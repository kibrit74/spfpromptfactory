export function getPromptPersistenceBlocker({
  userId,
  supabaseAdminAvailable,
  disabledReason,
} = {}) {
  if (!userId) {
    return {
      code: 'missing_user_id',
      message: 'Google login succeeded, but Supabase user sync is not complete.',
    };
  }

  if (!supabaseAdminAvailable) {
    return {
      code: 'supabase_unavailable',
      message: disabledReason || 'Supabase prompt persistence is unavailable.',
    };
  }

  return null;
}

export function normalizeSaveFailure(prompt, error) {
  return {
    prompt,
    prompt_id: null,
    save_status: 'failed',
    save_error: error?.message || 'Prompt generated, but it could not be saved to your profile.',
  };
}

export function buildRuntimeStatus({
  googleOAuthConfigured,
  googleCallbackUrl,
  geminiConfigured,
  geminiModel,
  supabaseConfigured,
  supabaseAdminAvailable,
  supabaseDisabledReason,
  promptPersistenceChecked = false,
  promptPersistenceOk = false,
  promptPersistenceError = '',
  promptMarketChecked = false,
  promptMarketOk = true,
  promptMarketError = '',
} = {}) {
  const marketOk = Boolean(promptMarketOk);
  return {
    ok: Boolean(googleOAuthConfigured && geminiConfigured && promptPersistenceOk && marketOk),
    google_auth: {
      ok: Boolean(googleOAuthConfigured),
      configured: Boolean(googleOAuthConfigured),
      callback_url: googleCallbackUrl || null,
      reason: googleOAuthConfigured ? null : 'Google OAuth client ID or secret is missing.',
    },
    gemini_runtime: {
      ok: Boolean(geminiConfigured),
      configured: Boolean(geminiConfigured),
      model: geminiModel || null,
      reason: geminiConfigured ? null : 'Gemini API key or Vertex AI project configuration is missing.',
    },
    supabase_prompt_persistence: {
      ok: Boolean(promptPersistenceOk),
      configured: Boolean(supabaseConfigured),
      admin_available: Boolean(supabaseAdminAvailable),
      checked: Boolean(promptPersistenceChecked),
      reason:
        promptPersistenceError ||
        supabaseDisabledReason ||
        (supabaseConfigured ? null : 'Supabase URL and API key are missing.'),
    },
    prompt_market: {
      ok: marketOk,
      checked: Boolean(promptMarketChecked),
      reason: promptMarketError || null,
    },
  };
}
