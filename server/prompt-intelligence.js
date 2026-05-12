export function parseJsonObject(text) {
  const raw = String(text || '').trim();
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fenced ? fenced[1].trim() : raw;
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');

  if (start === -1 || end === -1 || end < start) {
    throw new Error('Model did not return a JSON object.');
  }

  return JSON.parse(candidate.slice(start, end + 1));
}

export function normalizeAnalysisPayload(payload) {
  const qualityScore = Number(payload?.quality_score);
  return {
    missing_context: Array.isArray(payload?.missing_context) ? payload.missing_context : [],
    quality_score: Number.isFinite(qualityScore)
      ? Math.max(0, Math.min(100, Math.round(qualityScore)))
      : 0,
    quality_findings: Array.isArray(payload?.quality_findings) ? payload.quality_findings : [],
    test_cases: Array.isArray(payload?.test_cases) ? payload.test_cases : [],
  };
}

export function buildContextPackInstruction(contextPack) {
  if (!contextPack) return '';
  const name = contextPack.name || 'Untitled context pack';
  const description = contextPack.description || 'No description provided.';
  const content = contextPack.content || '';

  return [
    `CONTEXT PACK: ${name}`,
    `Description: ${description}`,
    'Content:',
    content,
  ].join('\n');
}

export function getNextVersionNumber(versions) {
  if (!Array.isArray(versions) || versions.length === 0) return 1;
  return Math.max(
    0,
    ...versions.map((version) => Number(version?.version_number) || 0),
  ) + 1;
}

export function buildTaskWithContext(task, contextPack) {
  const contextInstruction = buildContextPackInstruction(contextPack);
  if (!contextInstruction) return task.trim();
  return `${contextInstruction}\n\nUSER TASK:\n${task.trim()}`;
}

export function buildAnalysisPrompt(task, contextPack) {
  return `${buildTaskWithContext(task, contextPack)}

Return ONLY a valid JSON object with this exact shape:
{
  "missing_context": [
    {
      "label": "short missing context label",
      "reason": "why it matters",
      "question": "one concrete question to ask the user"
    }
  ],
  "quality_score": 0,
  "quality_findings": [
    "specific quality observation"
  ],
  "test_cases": [
    {
      "name": "test name",
      "scenario": "what to try",
      "expected": "expected behavior or output"
    }
  ]
}
Use quality_score from 0 to 100. Keep arrays short and practical.`;
}

export function buildRevisionPrompt({ currentPrompt, revisionInstruction, contextPack }) {
  const contextInstruction = buildContextPackInstruction(contextPack);
  return `${contextInstruction ? `${contextInstruction}\n\n` : ''}CURRENT SPF PROMPT:
${currentPrompt}

REVISION REQUEST:
${revisionInstruction.trim()}

Revise the CURRENT SPF PROMPT only according to the revision request.
Keep the SPF section order and section heading style intact.
Return ONLY the revised complete SPF prompt. No explanation before or after.`;
}
