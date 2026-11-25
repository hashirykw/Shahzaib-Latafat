/* AI paper checker — Vercel serverless function.
 *
 * Environment variables (Vercel → Project → Settings → Environment Variables):
 *   ANTHROPIC_API_KEY   required. Without it the site says the checker is "being switched on".
 *   STUDENT_CODES       required. Comma-separated class codes Sir Shazy hands out, e.g. "CEDAR26,WHALES26,TPC26".
 *   AI_MODEL            optional. Model for practice checks. Default: claude-haiku-5-5 (low cost).
 *   AI_TEST_MODEL       optional. Model for test checks. Default: same as AI_MODEL.
 *   CHECKER_OFF         optional. Set to "1" to pause the checker for everyone.
 *   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY   optional. When both are set, every check is saved to a
 *                       "checks" table so Sir Shazy can review tests (see README for the table).
 */
const API = 'https://api.anthropic.com/v1/messages';
const MAX_FILES = 6;
const SYL = {
  '4024': 'Cambridge O Level Mathematics (4024)',
  '0580': 'Cambridge IGCSE Mathematics (0580)',
  '4037': 'Cambridge O Level Additional Mathematics (4037)',
  '0606': 'Cambridge IGCSE Additional Mathematics (0606)',
  '9709-P1': 'Cambridge AS & A Level Mathematics (9709), Pure Mathematics 1',
  '9709-P2': 'Cambridge AS & A Level Mathematics (9709), Pure Mathematics 2',
  '9709-P3': 'Cambridge AS & A Level Mathematics (9709), Pure Mathematics 3',
  '9709-M1': 'Cambridge AS & A Level Mathematics (9709), Mechanics',
  '9709-S1': 'Cambridge AS & A Level Mathematics (9709), Probability & Statistics 1',
  '9709-S2': 'Cambridge AS & A Level Mathematics (9709), Probability & Statistics 2',
};

/* best-effort per-instance limit: 25 checks per code+IP per hour */
const HITS = new Map();
function limited(key) {
  const now = Date.now(), h = (HITS.get(key) || []).filter(t => now - t < 3600e3);
  h.push(now); HITS.set(key, h);
  return h.length > 25;
}

const TOOL = {
  name: 'record_marking',
  description: 'Record the marking of the student\'s answer.',
  input_schema: {
    type: 'object',
    properties: {
      readable: { type: 'boolean', description: 'False only if the working cannot be read or does not answer this question.' },
      score: { type: 'integer', description: 'Marks awarded, 0 to max.' },
      max: { type: 'integer' },
      summary: { type: 'string', description: 'One short sentence for the student, e.g. "Strong method, one sign slip. Three of four marks."' },
      marks: {
        type: 'array',
        description: 'Every mark available for this question, in the order a Cambridge mark scheme would list them.',
        items: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'Mark code as written on a script: M1, A1, B1, A0, M0, B0, DM1, A1ft and so on.' },
            awarded: { type: 'boolean' },
            for: { type: 'string', description: 'What this mark is for, under 8 words.' },
            comment: { type: 'string', description: 'Why it was given or lost, one short sentence, quoting the student\'s line where useful.' }
          },
          required: ['code', 'awarded', 'for', 'comment']
        }
      },
      lost: { type: 'array', items: { type: 'string' }, description: 'Each mistake that cost marks, one plain sentence each. Empty if full marks.' },
      working: { type: 'array', items: { type: 'string' }, description: 'The correct working, one line per step, final answer last. Use plain text maths (x², √, ≤, π).' },
      next_step: { type: 'string', description: 'One specific thing to practise or remember next time.' }
    },
    required: ['readable', 'score', 'max', 'summary', 'marks', 'lost', 'working', 'next_step']
  }
};

function system(syl, max, mode) {
  return [
    `You are an experienced Cambridge examiner marking ${SYL[syl] || 'Cambridge mathematics'} for Sir Shahzaib Latafat (Sir Shazy), a mathematics teacher in Karachi.`,
    `The question is worth ${max} mark${max > 1 ? 's' : ''}. Mark it exactly the way a Cambridge mark scheme would:`,
    '- M marks for a correct method applied to the student\'s own values; A marks for accuracy, which depend on the method mark before them; B marks for independent correct results; follow-through (ft) where the scheme would allow it.',
    '- First solve the question yourself and decide the mark scheme. Then mark only what the student actually wrote. Never assume a step they did not show. A correct final answer with no supporting working gets only what a Cambridge scheme would allow.',
    '- Credit correct alternative methods fully. Do not penalise poor handwriting if the maths can be read.',
    '- The total of awarded marks must equal score, and score must be between 0 and max. The marks list must account for all max marks.',
    '- If the pages are unreadable, blank, or answer a different question, set readable to false, score to 0, and say in the summary what to fix (for example: retake the photo flat in good light).',
    '- Write for a 15 to 18 year old student in Pakistan: short, clear, encouraging, no jargon beyond normal mark-scheme words.',
    mode === 'test' ? '- This is a test. Be strict and exact; Sir Shazy will review your marking.' : '- This is practice. Be exact, and make the next step genuinely useful.',
    'Always answer by calling the record_marking tool.'
  ].join('\n');
}

async function save(row) {
  const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) return;
  try {
    await fetch(url.replace(/\/$/, '') + '/rest/v1/checks', {
      method: 'POST',
      headers: { apikey: key, Authorization: 'Bearer ' + key, 'Content-Type': 'application/json', Prefer: 'return=minimal' },
      body: JSON.stringify(row)
    });
  } catch (e) { /* saving must never break marking */ }
}

module.exports = async (req, res) => {
  res.setHeader('Cache-Control', 'no-store');
  const send = (code, obj) => { res.statusCode = code; res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify(obj)); };
  if (req.method !== 'POST') return send(405, { error: 'method' });

  let b = req.body;
  if (typeof b === 'string') { try { b = JSON.parse(b); } catch (e) { b = null; } }
  if (!b || typeof b !== 'object') return send(400, { error: 'server' });

  const codes = String(process.env.STUDENT_CODES || '').split(',').map(c => c.trim().toUpperCase()).filter(Boolean);
  if (!process.env.ANTHROPIC_API_KEY || !codes.length) return send(503, { error: 'not_configured' });
  if (process.env.CHECKER_OFF === '1') return send(503, { error: 'off' });

  const code = String(b.code || '').trim().toUpperCase();
  if (!codes.includes(code)) return send(401, { error: 'bad_code' });
  if (b.verify) return send(200, { ok: true });

  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'ip';
  if (limited(code + '|' + ip)) return send(429, { error: 'rate' });

  const syl = SYL[b.syllabus] ? b.syllabus : '4024';
  const max = Math.max(1, Math.min(20, parseInt(b.max, 10) || 0));
  const mode = b.mode === 'test' ? 'test' : 'practice';
  const files = Array.isArray(b.files) ? b.files.slice(0, MAX_FILES) : [];
  const answer = String(b.answer || '').slice(0, 6000);
  const question = String(b.question || '').slice(0, 2000);
  if (!files.length && answer.trim().length < 5) return send(400, { error: 'server', message: 'Add your working first.' });

  const content = [];
  for (const f of files) {
    const data = String(f.data || '');
    if (!/^[A-Za-z0-9+/=]+$/.test(data.slice(0, 200))) continue;
    if (f.type === 'application/pdf') content.push({ type: 'document', source: { type: 'base64', media_type: 'application/pdf', data } });
    else content.push({ type: 'image', source: { type: 'base64', media_type: 'image/jpeg', data } });
  }
  const parts = [
    `Syllabus: ${SYL[syl]}`,
    b.qno ? `Question reference: ${String(b.qno).slice(0, 40)}` : '',
    `Marks available: ${max}`,
    question ? `Question:\n${question}` : (b.questionInPages ? 'The question is printed or written on the first page provided.' : ''),
    files.length ? `The student's working is in the ${files.length > 1 ? files.length + ' pages' : 'page'} above.` : `Student's working (typed, one step per line):\n${answer}`
  ].filter(Boolean);
  content.push({ type: 'text', text: parts.join('\n\n') });

  const model = (mode === 'test' && process.env.AI_TEST_MODEL) || process.env.AI_MODEL || 'claude-haiku-5-5';
  let out;
  try {
    const r = await fetch(API, {
      method: 'POST',
      headers: { 'x-api-key': process.env.ANTHROPIC_API_KEY, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' },
      body: JSON.stringify({
        model, max_tokens: 2500,
        system: system(syl, max, mode),
        tools: [TOOL], tool_choice: { type: 'tool', name: 'record_marking' },
        messages: [{ role: 'user', content }]
      })
    });
    const j = await r.json();
    if (!r.ok) { console.error('AI error', r.status, j && j.error); return send(502, { error: r.status === 413 ? 'too_big' : 'server' }); }
    const use = (j.content || []).find(c => c.type === 'tool_use');
    if (!use) return send(502, { error: 'server' });
    out = use.input;
  } catch (e) {
    console.error('AI call failed', e);
    return send(502, { error: 'server' });
  }

  /* keep the numbers honest whatever the model returns */
  const marks = Array.isArray(out.marks) ? out.marks.slice(0, 30).map(m => ({ code: String(m.code || '').slice(0, 8), awarded: !!m.awarded, for: String(m.for || '').slice(0, 120), comment: String(m.comment || '').slice(0, 300) })) : [];
  const result = {
    readable: out.readable !== false,
    max,
    score: Math.max(0, Math.min(max, parseInt(out.score, 10) || 0)),
    summary: String(out.summary || '').slice(0, 240),
    marks,
    lost: (Array.isArray(out.lost) ? out.lost : []).slice(0, 8).map(s => String(s).slice(0, 300)),
    working: (Array.isArray(out.working) ? out.working : []).slice(0, 30).map(s => String(s).slice(0, 200)),
    next_step: String(out.next_step || '').slice(0, 300)
  };
  if (!result.readable) result.score = 0;

  await save({ code, mode, name: String(b.name || '').slice(0, 60) || null, syllabus: syl, question_ref: String(b.qno || '').slice(0, 40) || null,
    question: question || null, answer_text: answer || null, pages: files.length, score: result.score, max_marks: max, result, status: mode === 'test' ? 'pending' : 'final' });

  return send(200, { ok: true, status: mode === 'test' ? 'pending' : 'final', result });
};
