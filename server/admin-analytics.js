export function parseAdminEmails(value = '') {
  return String(value)
    .split(',')
    .map((email) => email.trim().toLowerCase())
    .filter(Boolean);
}

export function isAdminUser(user, adminEmails = '') {
  if (!user) return false;
  if (user.is_admin) return true;
  const email = String(user.email || '').trim().toLowerCase();
  return Boolean(email && parseAdminEmails(adminEmails).includes(email));
}

function startOfUtcDay(now = new Date()) {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

function isToday(value, now) {
  if (!value) return false;
  return new Date(value) >= startOfUtcDay(now);
}

function isRevision(version) {
  return Boolean(version?.revision_instruction) || Number(version?.version_number || 0) > 1;
}

export function buildAdminOverview(data, now = new Date()) {
  const users = data.users || [];
  const prompts = data.prompts || [];
  const promptVersions = data.promptVersions || [];
  const creditTransactions = data.creditTransactions || [];
  const revisions = promptVersions.filter(isRevision);

  return {
    total_users: users.length,
    total_prompts: prompts.length,
    total_revisions: revisions.length,
    daily_prompts: prompts.filter((prompt) => isToday(prompt.created_at, now)).length,
    daily_revisions: revisions.filter((version) => isToday(version.created_at, now)).length,
    total_credit_balance: creditTransactions.reduce(
      (total, transaction) => total + Number(transaction.delta || 0),
      0,
    ),
    total_credits_spent: creditTransactions.reduce((total, transaction) => {
      const delta = Number(transaction.delta || 0);
      return delta < 0 ? total + Math.abs(delta) : total;
    }, 0),
    total_credits_added: creditTransactions.reduce((total, transaction) => {
      const delta = Number(transaction.delta || 0);
      return delta > 0 ? total + delta : total;
    }, 0),
  };
}

export function buildAdminUserRows(data) {
  const users = data.users || [];
  const prompts = data.prompts || [];
  const promptVersions = data.promptVersions || [];
  const creditTransactions = data.creditTransactions || [];

  const promptUserMap = new Map(prompts.map((prompt) => [prompt.id, prompt.user_id]));

  return users.map((user) => {
    const userPrompts = prompts.filter((prompt) => prompt.user_id === user.id);
    const userRevisions = promptVersions.filter((version) => {
      const promptUserId = version.user_id || promptUserMap.get(version.prompt_id);
      return promptUserId === user.id && isRevision(version);
    });
    const creditsBalance = creditTransactions
      .filter((transaction) => transaction.user_id === user.id)
      .reduce((total, transaction) => total + Number(transaction.delta || 0), 0);

    return {
      ...user,
      credits_balance: creditsBalance,
      prompt_count: userPrompts.length,
      revision_count: userRevisions.length,
      last_prompt_at: userPrompts
        .map((prompt) => prompt.created_at)
        .filter(Boolean)
        .sort()
        .reverse()[0] || null,
    };
  });
}

export function buildAdminCreditTransactionRows(transactions = [], users = []) {
  const usersById = new Map(users.map((user) => [user.id, user]));

  return transactions.map((transaction) => {
    const user = usersById.get(transaction.user_id);
    const userName = user?.name || null;
    const userEmail = user?.email || null;
    const displayLabel = userEmail
      ? `${userName || 'Isimsiz'} <${userEmail}>`
      : 'Bilinmeyen kullanici';

    return {
      ...transaction,
      user_email: userEmail,
      user_name: userName,
      display_label: displayLabel,
    };
  });
}
