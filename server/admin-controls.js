const ACTION_LIMIT_FIELD = {
  generate: 'daily_prompt_limit',
  revise: 'daily_revision_limit',
  analyze: 'daily_analysis_limit',
};

function normalizeLimit(value) {
  if (value === '' || value === null || typeof value === 'undefined') return null;
  const number = Number(value);
  if (!Number.isInteger(number) || number < 0) return null;
  return number;
}

export function normalizeUserControls(input = {}) {
  return {
    is_blocked: Boolean(input.is_blocked),
    block_reason: typeof input.block_reason === 'string' ? input.block_reason.trim() : '',
    admin_notes: typeof input.admin_notes === 'string' ? input.admin_notes.trim() : '',
    daily_prompt_limit: normalizeLimit(input.daily_prompt_limit),
    daily_revision_limit: normalizeLimit(input.daily_revision_limit),
    daily_analysis_limit: normalizeLimit(input.daily_analysis_limit),
  };
}

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isToday(value, now) {
  if (!value) return false;
  return new Date(value) >= startOfUtcDay(now);
}

export function getDailyUsageCounts(data, userId, now = new Date()) {
  const prompts = data.prompts || [];
  const creditTransactions = data.creditTransactions || [];

  return {
    generate: prompts.filter((prompt) => prompt.user_id === userId && isToday(prompt.created_at, now)).length,
    revise: creditTransactions.filter(
      (transaction) =>
        transaction.user_id === userId &&
        transaction.reason === 'revise' &&
        isToday(transaction.created_at, now),
    ).length,
    analyze: creditTransactions.filter(
      (transaction) =>
        transaction.user_id === userId &&
        transaction.reason === 'analyze' &&
        isToday(transaction.created_at, now),
    ).length,
  };
}

export function evaluateActionAccess(user, action, usageCounts) {
  if (user?.is_blocked) {
    return {
      allowed: false,
      status: 403,
      reason: user.block_reason || 'User is blocked',
    };
  }

  const limitField = ACTION_LIMIT_FIELD[action];
  const limit = normalizeLimit(user?.[limitField]);
  const used = Number(usageCounts?.[action] || 0);

  if (limit !== null && used >= limit) {
    return {
      allowed: false,
      status: 429,
      reason: `Daily ${action} limit reached`,
    };
  }

  return { allowed: true, status: 200, reason: null };
}

export function buildActiveRecords(records, now = new Date()) {
  return (records || []).filter((record) => {
    if (record.status !== 'active' && record.is_active !== true) return false;
    if (record.starts_at && new Date(record.starts_at) > now) return false;
    if (record.ends_at && new Date(record.ends_at) < now) return false;
    return true;
  });
}
