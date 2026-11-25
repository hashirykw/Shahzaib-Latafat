# Sir Shahzaib Latafat · Maths With Sir Shazy

Website for Sir Shahzaib Latafat (Sir Shazy), O Level, IGCSE and A Level Mathematics teacher in Karachi.
Live at **https://shahzaib-latafat.nexlyr.solutions**. Built by Nexlyr Solutions on the same system as the Sir Saud Barlas site.

## What's on the page

`index.html` is the whole site, one self-contained file (styles and scripts inline):

- Preloader warm-up quiz, 3D maths field background, dark / paper themes, crossing ribbons
- About, courses (4024 · 0580, 4037 · 0606, 9709), the five-step method
- **Paper Vault**: question papers, mark schemes, examiner reports and grade thresholds for 4024, 0580, 4037, 0606 and 9709 (2016 onward), from PapaCambridge's public archive
- **Maths Lab**: Graph Studio, quadratic and simultaneous solvers, triangle solver, score planner
- **YKW Calculator** (`ykw.html`, loaded in a frame)
- **AI Paper Checker** (new): how it works, a tappable marked sample, practice vs test, and the checker itself
- Where he teaches, YouTube, FAQ, contact form, install-as-app, Shazy Assistant chatbot

Other files: `api/check.js` (the checker's server function), `manifest.webmanifest`, `sw.js`, `offline.html`, icons, `vercel.json`, `robots.txt`, `sitemap.xml`.

## Switch on the AI checker

In Vercel → Project → Settings → Environment Variables, add:

| Variable | Value |
|---|---|
| `ANTHROPIC_API_KEY` | Your Anthropic API key (required) |
| `STUDENT_CODES` | Class codes Sir Shazy hands out, comma-separated, e.g. `CEDAR26,WHALES26,TPC26` (required) |
| `AI_MODEL` | Optional. Practice model, default `claude-haiku-5-5` (low cost) |
| `AI_TEST_MODEL` | Optional. Model for tests, default same as `AI_MODEL` |
| `CHECKER_OFF` | Optional. `1` pauses the checker for everyone |

Then redeploy. Until the key and codes are set, the site says the checker is "being switched on" and the sample still works.

How it works: the student enters their class code once (remembered on that device), chooses the syllabus, question and marks, then types the working or adds up to 6 photos or one PDF. Photos are shrunk on the phone and checked for blur and darkness before sending. The function marks with M, A and B marks against a Cambridge-style scheme and returns marks line by line, where marks were lost, the correct working and a next step. The site stores nothing: recent checks are kept only in the student's own browser.

**Tests reviewed by Sir Shazy (optional).** To keep every check for review, create a Supabase table and add `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`:

```sql
create table checks (
  id bigint generated always as identity primary key,
  created_at timestamptz default now(),
  code text, mode text, name text, syllabus text, question_ref text,
  question text, answer_text text, pages int,
  score int, max_marks int, result jsonb, status text
);
alter table checks enable row level security;
```

An admin panel to approve tests can be built on top of this table later.

## Check before going live

1. **WhatsApp number.** In `index.html`, set `const WA = ''` to his number (digits only, e.g. `923001234567`). While it's blank, message buttons open his Instagram inbox (`@shahzaib_latafat`) and the contact form copies the message for pasting.
2. **Photo.** Add a portrait as `shahzaib-latafat.webp` and swap the `.portrait-art` block in About (comment marks the spot).
3. **Facts.** MSc Statistics (gold medalist), Best Teacher Award (The City School Southern Region, 2014–15), Cedar College, Whales College and The Professionals come from public pages and posts. Confirm with Sir Shazy.
4. **YouTube.** Buttons search for "Sir Shazy Mathematics". Replace with his channel URL once confirmed.
5. **Student codes.** Set `STUDENT_CODES` and share one code per class.
