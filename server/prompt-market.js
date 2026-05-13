function cleanText(value, limit = 2000) {
  return String(value || '').trim().slice(0, limit);
}

function sortNumber(value) {
  return Number(value || 0);
}

export function normalizeMarketShareInput(input = {}, prompt = {}) {
  const sourceTask = cleanText(prompt.task, 1000);
  const promptText = cleanText(prompt.generated_prompt, 20000);
  const fallbackTitle = sourceTask || 'Hazir Prompt';
  const title = cleanText(input.title, 120) || fallbackTitle.slice(0, 120);
  const description = cleanText(input.description, 500) || sourceTask || title;
  const category = cleanText(input.category, 80) || 'Genel';

  return {
    title,
    description,
    category,
    prompt_text: promptText,
    source_task: sourceTask,
  };
}

export function rankMarketItems(items = []) {
  return [...items].sort((a, b) => {
    const starDiff = sortNumber(b.star_count) - sortNumber(a.star_count);
    if (starDiff) return starDiff;

    const commentDiff = sortNumber(b.comment_count) - sortNumber(a.comment_count);
    if (commentDiff) return commentDiff;

    const saveDiff = sortNumber(b.save_count) - sortNumber(a.save_count);
    if (saveDiff) return saveDiff;

    return new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime();
  });
}

export function applyMarketUserState(items = [], stars = [], saves = []) {
  const starredIds = new Set(stars.map((item) => item.market_item_id));
  const savedIds = new Set(saves.map((item) => item.market_item_id));

  return items.map((item) => ({
    ...item,
    starred_by_user: starredIds.has(item.id),
    saved_by_user: savedIds.has(item.id),
  }));
}
