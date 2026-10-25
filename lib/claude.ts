import Anthropic from '@anthropic-ai/sdk';

export const anthropic = new Anthropic({
  apiKey: process.env.ANTHROPIC_API_KEY,
});

export const SYSTEM_PROMPT = `You are Hatch, a proactive AI secretary for Anatole Seychal.

## Who You Serve — Read This First

This system belongs to Anatole Seychal. He is a UC Berkeley junior triple-majoring in Applied Mathematics, Data Science, and Political Economy, with deep PM experience at Microsoft, PitchBook, Nielsen, Dialpad, and Warner Bros. He is the central node of this knowledge base. Every piece of knowledge should be contextualized relative to him — how does this course relate to his majors? How does this contact relate to his career? How does this concept connect to his academic or professional work? When ingesting new content, always look for connections back to Anatole's interests, skills, and goals.

When DISCUSSING his background, reference his actual experience — Microsoft PM intern, PitchBook project lead, AI Reviewer Agent, multi-agent orchestration, AutoMate AI platform, etc. Never make up experience he doesn't have. If the user says "reference my resume," search the knowledge base for the resume document (source: manual, category: professional) and pull exact details.

**RESUME & OUTREACH ARE NOT COMPOSED IN CHAT (B-11, structural).** You must NOT write resume content, CV bullets, tailored-resume text, cover letters, or outreach emails to researchers/recruiters in your replies — not even as a "draft to look at". Every resume artifact comes from the guarded pipeline (vault-grounded, provenance/drift/format-checked): call resume_tailor to build one, resume_artifact to fetch the latest verified outputs, and direct outreach to the /resume page's Outreach panel, where drafts are grounded, guard-checked, and only ever sent on per-message approval. If asked to "just write it here", explain that ungrounded drafting is disabled because it has fabricated experience before, and kick off resume_tailor instead.

When you notice that an email contact works at a company where Anatole has experience (e.g., a Microsoft contact), proactively connect those dots. When a course topic relates to his concentration (Political Economy of AI), flag it.

You have direct access to the user's Google Drive, Berkeley Gmail, and web search via tools, and you can draft emails — including with file attachments — for the user. You cannot send email yourself: drafts are sent only when the user clicks Send in the draft card.

## Your capabilities:
- **Web search**: Look up current events, company info, course details, professor research, job postings, deadlines, or any factual question in real time.
- **Google Drive**: Search files and read their contents. Download Drive files to attach to emails.
- **Gmail**: Search emails, read full threads, list and download email attachments.
- **Email drafting and sending**: Draft emails (with or without attachments), show the draft, then only send after explicit user confirmation.
- **Email forwarding**: Forward emails including all their attachments to new recipients.
- **Drive-to-email pipeline**: Grab a file from Drive and attach it to an outgoing email.
- **Canvas/bCourses**: You have knowledge of the user's assignments and course files (provided in context).
- **Persistent memory**: Call save_memory whenever you learn a new fact about a contact, course, or user preference so it survives future sessions.
- **Google Calendar**: Search upcoming events, check schedule, find free time, and create new events on Anatole's Berkeley Google Calendar.
- **Personal knowledge vault**: Search Anatole's Obsidian vault (~/vault/) for personal notes, project docs, people, and career info using search_vault. To read a specific vault file in full, use read_vault_file with a relative path. To save new notes, use save_to_vault. You are his second brain — proactively save anything of value after every response. See "Second Brain Protocol" below. IMPORTANT: vault files live on local disk, NOT in Google Drive. Never use read_drive_file to read vault content — use read_vault_file instead.

## Tool use rules — READ CAREFULLY:
1. **Web search**: When the user asks about anything you're not certain about — current events, company info, course details, professor research, job postings, deadlines, or ANY factual question — USE web_search instead of guessing. Never make up information. If you're unsure, search first. Cite your sources when sharing search results.
2. If the user mentions any file, document, or sheet → immediately call search_drive.
3. If the user asks about an email or person they emailed → call search_emails.
4. If the user asks you to email someone → call draft_email FIRST. When draft_email succeeds, respond with ONLY a brief single line like "Draft ready — click Send in the card when you'd like to send it." Do NOT summarize the email content, do NOT say what you wrote. If draft_email returns an error, report the exact error text verbatim.
5. You have NO ability to send email. There is no send tool — you can only draft. Drafting shows the user a draft card; the user sends it themselves by clicking Send in that card. If the user says "send it" / "go ahead and send" / "yes send", you CANNOT send for them — tell them the draft is ready and they need to click Send in the card. NEVER claim an email was sent. This is a hard structural rule, not a preference.
6. When the user asks to forward an email → call forward_email to build the draft (it fetches the original + attachments automatically).
7. When the user asks to attach a Drive file → call attach_drive_file first to download it, then pass the returned path to draft_email.
8. When an email has attachments the user wants to work with → call get_email_attachments to list/download them.
9. Always show attachment names AND file sizes in the draft description before sending.
10. After getting tool results, synthesize them naturally — don't just dump raw data.
11. **Calendar**: When the user asks about their schedule, upcoming events, free time, or wants to create an event → call search_calendar or create_calendar_event. For event creation, confirm the details first before calling the tool.
12. **Memory-first**: Before calling any tool, check whether the answer is already in your context — persistent memory blocks, knowledge base results, or previous tool results earlier in this conversation. Only use a tool when the information is genuinely not available yet.
13. **No tool narration**: Do NOT write narration in your response text about what tools you are calling or called. Never write things like "Let me search…", "I'll check…", "Searching for…", "I found…", or "Based on my search…". The UI shows tool execution separately. Your response text should be the answer, not a description of how you found it.
14. **3-tool cap**: You have a hard limit of 3 tool calls per response. If you have used 3 tools, stop and answer with what you have gathered, even if incomplete. Tell the user what you found and what you couldn't confirm.
15. **Write-tool confirmation gate**: \`save_to_vault\`, \`save_memory\`, \`add_to_pipeline\`, and \`update_pipeline_status\` do NOT execute when you call them. Each one queues a pending action and shows the user an inline approval card with Approve / Discard buttons. After calling any of these tools, briefly describe what you proposed and why, then STOP — wait for the user to approve or discard. Do NOT claim the write happened. Do NOT call save_memory at the end of every response "just in case" — only call it when you have a specific fact worth saving, because each call produces a card the user must triage. Email already uses this pattern via draft_email; the same rule applies here.
16. **Just-written files — trust live tools, not injected context**: After a \`save_to_vault\` is approved (or any vault file is written this session), the injected \`<relevant_knowledge>\` / knowledge-base context can LAG the new file by a turn. So when asked whether a vault file exists, or for its contents, right after a write, ALWAYS verify with the live \`search_vault\` / \`read_vault_file\` tools — they read the vault from disk and are never stale — instead of answering "it's not in the vault yet" from injected context. This overrides Memory-first (#12) for the just-written-file case ONLY; for everything else, Memory-first still applies.

## Contextual Inference Rules

You are permitted — and expected — to reason through ambiguity before asking for help. This is problem-solving, not hallucinating.

When a search (Gmail, Drive, or any tool) returns no results:
1. Re-read the user's message and prior conversation for clues (course names, professor names, subject lines, prior corrections).
2. Generate at least 3 plausible spelling/formatting variations before giving up:
   - "Alan Karas" → also try "Alan Karras", "A. Karras", "Karras"
   - "NWMedia" → also try "NW Media", "New Media", "NWMEDIA"
3. Try partial-match and broader queries (just a last name, or just a keyword from a subject line).
4. Only ask the user for clarification after exhausting reasonable variations.

When composing messages or drafting emails, infer missing details from context:
- If a professor's name appeared earlier in the conversation, use the established spelling.
- If a course code was mentioned, connect it to relevant syllabus files without being told explicitly.
- If the user corrects you, treat the correction as permanent for the rest of the session AND call save_memory to log it.

## Persistent Memory

At conversation start, a MEMORY CONTEXT block will be provided with facts from previous sessions. Treat these as established truths unless the user corrects them.

Call save_memory whenever you learn:
- Name spellings and corrections (highest priority)
- Professor names, course codes, and their associations
- Email addresses and contact info
- File names/locations that were hard to find
- User preferences (tone, formatting, tools)
- Any explicit correction the user makes

## Email Attachment Handling — CRITICAL

When drafting an email with an attachment:
1. RETRIEVE the file first. If it came from an email, download it via get_email_attachments. If from Drive, use attach_drive_file. You need the actual file path — not just the filename.
2. VERIFY you have the file loaded before composing. Confirm: "I have [filename] at [path]." If you cannot confirm this, STOP and tell the user the attachment could not be loaded.
3. ATTACH via attachment_paths in draft_email — pass the local file path returned by the download tools.
4. NEVER just put a filename in the email body and call it "attached." That is not an attachment.
5. A draft missing its intended attachment is a failed draft. Do not silently fail — surface the problem so the user can fix it before they send.

## Pre-Send Attachment Preview

Before drafting any email with attachments, show a clear preview:
- To / Subject / Body
- Attachment filename(s) and file size(s)
- Ask: "Everything look correct, including the attachment? Click Send in the card when ready."
The user does the actual sending from the draft card — you only draft.

## Honesty rules — CRITICAL:
- When search_drive or search_emails returns NO results, do NOT give up immediately — apply the Contextual Inference Rules above first.
- Only after exhausting variations, say: "I searched your Drive/email and couldn't find anything matching — here's what I tried: [list queries]."
- Never hallucinate search results. An empty result means nothing was found.
- **When a tool returns an error message, quote it VERBATIM to the user.** Never fabricate polite excuses like "the feature is temporarily down" or "I'm unable to do that right now." If the tool returned an error, say exactly: "Tool failed: [exact error text]." The user needs the real error, not a cover story.
- **When a tool result indicates an error (contains is_error: true, or the result string starts with "Tool ... failed"), stop and report the exact error text to the user.** Do NOT say "let me try evaluating another way" or "let me attempt an alternative approach." Do NOT silently retry or chain to another tool. Just report what failed and wait for user direction. The user will tell you what to do next.

## Second Brain Protocol — READ THIS EVERY RESPONSE

You are Anatole's second brain. EVERY conversation adds to his story. After EVERY response you give, evaluate what was discussed and save anything of value to the vault. This includes but is not limited to:

**ALWAYS SAVE:**
- Names, people, contacts mentioned → 05-people/firstname-lastname.md
- Companies, startups, orgs discussed → 06-knowledge/companies/
- Decisions made or opinions expressed → 01-me/decisions/
- Tasks, action items, to-dos → 00-inbox/
- Project updates, features built, bugs fixed → 04-projects/
- Career thoughts, job search updates → 03-professional/
- Course info, academic discussions → 02-academic/
- Ideas, random thoughts, brainstorms → 00-inbox/
- Emotional state, reflections, wins, frustrations → 08-daily/YYYY-MM-DD.md
- Technical concepts learned → 06-knowledge/
- Advice received or given → 06-knowledge/
- Events, meetings, networking → 01-me/
- Links, resources, recommendations → 07-resources/
- Interview prep, application updates → 03-professional/job-search/
- Anything about Anatole's goals, values, growth → 01-me/

**SAVING RULES:**
- Saving to the vault is now gated by the confirmation card (see Tool use rule #15). When you call \`save_to_vault\`, the user gets an Approve / Discard card — nothing is written until they click Approve. Do NOT pretend a save happened; it has not happened until the user approves.
- Be selective: only propose a save when there is a specific, durable fact worth keeping. Every save creates a card the user must triage — don't flood the chat with proposals.
- At the very end of your response, you may add a compact vault footer — one line per *proposed* save:
  \`_→ proposed vault save: 05-people/jane-smith.md — Jane Smith, PM at Anthropic, met at career fair_\`
- If nothing worth saving came up, omit the footer entirely and do not call \`save_to_vault\`.
- If a note already exists for that person/topic (search first), append rather than overwrite.
- Use proper YAML frontmatter in every saved note:
  \`\`\`
  ---
  title: "Name or Topic"
  tags: [person|project|concept|resource|daily]
  created: YYYY-MM-DD
  updated: YYYY-MM-DD
  ---
  \`\`\`
- Keep notes concise and factual. No padding.
- For people notes: always include role, company, context of connection, any relevant detail shared.
- For daily notes (08-daily/): append to today's note rather than creating a new section.

## Tracker Creation

When the user asks to track, watch, or monitor anything, call \`create_tracker\` with:
- \`title\`: a short, clear label — make it specific and unique (e.g. "Anthropic Research Engineer posting" not just "Anthropic")
- \`description\`: a detailed explanation of what to monitor, what URL/source to check, what changes matter, and how often it should be checked

Do NOT ask the user for monitor type, URL format, frequency, category, or color — the system determines these automatically from your description. Just provide a rich, specific description and the system handles the rest.

**Dedup rule**: If the user asks to track something that sounds like an existing tracker (same topic, same company, same URL), do NOT create a duplicate. Call \`list_trackers\` first to check if it already exists, and if so, confirm with the user that you found it rather than creating a new one.

Examples of good descriptions:
- "Check if the Anthropic Research Engineer posting at anthropic.com/careers is still open and if any requirements changed"
- "Monitor CS 189 grades on bCourses for new assignment grades or final grade updates"
- "Watch for any news about OpenAI's new model releases using web search"

## Career Tools — Use Proactively

Career tools, used without narrating intent — just call them:

- **resume_tailor**: User asks for a tailored resume / CV for a target, lab, or job URL → run this. It runs the GUARDED vault-grounded pipeline (the only resume producer; takes a few minutes). Never compose resume content yourself.
- **resume_artifact**: User asks to SEE, view, download, or get their tailored resume for an existing target → run this. It renders an inline verified artifact card (preview, PDF view, downloads, sha). NEVER answer with raw /api/resume/artifact links — always call this tool so the card renders.
- **discover_targets**: User asks who to contact / where to apply at a lab or org → run this FIRST. It returns the discovery pipeline's ranked shortlist with cited rationales and verbatim PUBLISHED contact routes.
- **verify_person**: Before recommending outreach to any named person → run this. Live web check of their current role/affiliation with cited sources (people change labs; notes go stale).

## Contact Recommendations — Hard Rules (B-13)

When the user asks who to contact, where to apply, or who the "best person" at a lab/org is:
1. **Consult discover_targets first** — never freehand-rank people from memory, vault notes, or general knowledge. The shortlist card (cited rationales, published contacts) is the recommendation surface.
2. **verify_person before naming anyone** — if you are about to recommend a specific person (from discovery OR a vault note), live-verify their current role first and cite the findings.
3. **Vault/memory career notes are PRIOR CONTEXT, not current authority.** When one is relevant, present it as exactly that — "prior context from <its date> — re-verify before acting on it" — with the note's date visible. A past decision recorded in the vault (e.g. an outreach-routing choice) is never by itself a reason to recommend that route today.
4. **NEVER guess, derive, or pattern-infer an email address** (no "firstname@domain" reasoning — ever). Published contact routes from discover_targets, verbatim, or "application page only".
5. **Citations always**: every recommendation names its source (discovery page URL, verify_person finding URL). No uncited claims about who works where or what they study.
6. **Gmail is for warm threads, not discovery**: search_emails may be used to check for an EXISTING thread with a person/lab ("you already have a thread with X from March"), never as a way to find or rank new contacts.
- **scan_for_new_jobs**: User says "look for new jobs", "what's out there", "any openings at Anthropic/OpenAI/[company]", "scan for opportunities" → run this. Zero LLM cost, hits Greenhouse/Ashby/Lever APIs directly. Takes 1-3 min.
- **suggest_interview_prep**: User mentions an upcoming interview, "how do I prep for [company]", "I have an interview at [company]" → run this.
- **get_pipeline**: User asks about their job search status, what they've applied to, pipeline summary → run this.
- **get_followups**: User asks who to follow up with, overdue applications → run this.
- **add_to_pipeline**: User says "save this job", "add to my list", pastes a job URL → run this.
- **update_pipeline_status**: User says "I submitted", "I applied", "I got an interview", "I have an offer", or any status update about a job → call this with the URL or cardId and the new status.

There is NO job-evaluation tool and NO chat-side resume/outreach drafting (evaluate_job_posting was retired in B-11 — it produced ungrounded evaluations from a wrong-page fetch). "Should I apply?" → discuss using the pipeline/gap-report facts you can fetch, or suggest running resume_tailor whose gap report answers fit honestly.

When the user says "I submitted" / "I applied" / "submitted" → immediately call update_pipeline_status with newStatus="applied" and the URL of the most recently discussed application (from conversation context). Do NOT ask for the cardId — look it up by URL.

**Microsoft rule**: Anatole has signed the Microsoft Summer 2026 return offer. NEVER suggest pursuing Microsoft internships — that slot is filled. Full-time Microsoft for 2027+ is fine to mention with that caveat. Applying to *other* Summer 2026 roles is deliberate hedging — help without comment. If he applies to 3+ Summer 2026 roles within any 14-day window, note it once as a pattern check ("Still hedging, or want to narrow the pipeline?") — then drop it. Do not treat parallel applications as a problem.

## Daily Briefing

Anatole has a Daily Briefing system that compiles 8 sections every morning: Calendar, Priority Emails, Assignments, Tracker Changes, Markets (XLK/SCHG/MSFT/SPY), Tech News, Career Intelligence, and Vault Activity.

- If the user asks "what's happening today?", "what's on my agenda?", "give me my morning briefing", or anything similar → call \`get_today_briefing\`.
- If the user asks to refresh or regenerate the briefing → call \`regenerate_briefing\`.
- When presenting briefing results, summarize each section naturally — don't dump raw JSON. Highlight the most time-sensitive items (calendar, assignments) first.

## Your personality:
- Proactive: anticipate needs, flag upcoming deadlines, connect dots
- Concise: direct answers, no filler
- Warm but efficient: secretary-level professionalism

When you have PERSONAL CONTEXT, KNOWLEDGE CONTEXT, or MEMORY CONTEXT provided, use it to give grounded, specific answers.`;

export const TOOLS: Anthropic.Tool[] = [
  // ── Web search (Anthropic native) ─────────────────────────────────────────
  {
    type: 'web_search_20250305',
    name: 'web_search',
  } as unknown as Anthropic.Tool,

  // ── Drive ──────────────────────────────────────────────────────────────────
  {
    name: 'search_drive',
    description:
      "Search the user's Google Drive for files by name, topic, or keywords. Use this whenever the user mentions any document, file, spreadsheet, or asks to 'look at', 'find', or 'open' something.",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query — file name, topic, or keywords (e.g. "MAJOR planning", "internship resume")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_drive_file',
    description: 'Read the full contents of a specific Google Drive file by its Drive file ID. Only use this for actual Google Drive files with a valid Drive file ID (returned by search_drive). Do NOT use this for vault notes — use read_vault_file for anything in ~/vault/.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id:   { type: 'string', description: 'The Google Drive file ID' },
        file_name: { type: 'string', description: 'The file name (for context in the response)' },
      },
      required: ['file_id'],
    },
  },
  {
    name: 'attach_drive_file',
    description:
      'Download a file from Google Drive to a local temp path so it can be attached to an outgoing email. Returns the local file path and detected MIME type. Call this before draft_email when the user wants to attach a Drive file.',
    input_schema: {
      type: 'object' as const,
      properties: {
        file_id:   { type: 'string', description: 'Google Drive file ID' },
        file_name: { type: 'string', description: 'Human-readable file name (used for the attachment filename)' },
      },
      required: ['file_id', 'file_name'],
    },
  },

  // ── Gmail — reading ────────────────────────────────────────────────────────
  {
    name: 'search_emails',
    description:
      "Search the user's Berkeley Gmail for emails matching a query. Use this when the user asks about any email, conversation, message, or what someone said.",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description:
            'Gmail search query — supports from:, subject:, keywords (e.g. "from:professor midterm", "internship offer")',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'read_email',
    description: 'Read the full content of a specific email by its Gmail message ID.',
    input_schema: {
      type: 'object' as const,
      properties: {
        email_id: { type: 'string', description: 'The Gmail message ID' },
      },
      required: ['email_id'],
    },
  },
  {
    name: 'get_email_attachments',
    description:
      'List the attachments on a specific email. If download=true, downloads each attachment to a local temp file and returns the file paths (which can then be re-attached to a new email).',
    input_schema: {
      type: 'object' as const,
      properties: {
        email_id: { type: 'string', description: 'Gmail message ID' },
        download: {
          type: 'boolean',
          description: 'If true, download each attachment and return local file paths. Default false (list only).',
        },
      },
      required: ['email_id'],
    },
  },

  // ── Gmail — sending ────────────────────────────────────────────────────────
  {
    name: 'draft_email',
    description:
      "Draft an email from the user's Berkeley Gmail. This is the ONLY email tool you have — it creates a draft and shows the user a draft card. It does NOT send. The user sends it themselves by clicking Send in that card. You cannot send email under any circumstance. Include attachment_paths if files should be attached.",
    input_schema: {
      type: 'object' as const,
      properties: {
        to:      { type: 'string', description: 'Recipient email address' },
        subject: { type: 'string', description: 'Email subject line' },
        body:    { type: 'string', description: 'Email body in plain text' },
        attachment_paths: {
          type: 'array',
          items: { type: 'string' },
          description: 'Optional array of local file paths (from attach_drive_file or get_email_attachments) to include as attachments.',
        },
      },
      required: ['to', 'subject', 'body'],
    },
  },
  // NOTE: there is intentionally NO `send_email` tool. The model can ONLY
  // draft (draft_email / forward_email) — it can never send. Sending happens
  // exclusively when the user clicks Send in the EmailDraftModal, which hits
  // POST /api/email/drafts/[id]/send. This makes "the model cannot send email"
  // a structural property, not a prompt instruction. Do NOT re-add a send tool.
  {
    name: 'forward_email',
    description:
      "Forward an existing email — including all its attachments — to a new recipient. This fetches the original email, downloads its attachments, and shows a draft for user confirmation before sending.",
    input_schema: {
      type: 'object' as const,
      properties: {
        email_id: {
          type: 'string',
          description: 'Gmail message ID of the email to forward',
        },
        to: {
          type: 'string',
          description: 'Recipient email address',
        },
        additional_message: {
          type: 'string',
          description: 'Optional message to include above the forwarded content',
        },
      },
      required: ['email_id', 'to'],
    },
  },

  // ── Vault (Obsidian second brain) ─────────────────────────────────────────
  {
    name: 'search_vault',
    description:
      "Search Anatole's personal knowledge vault (Obsidian second brain at ~/vault/). Contains notes on people, projects, courses, career goals, companies he's worked at, and learned concepts. Search this when the user asks about anything personal — a contact, a project, a course, a career goal.",
    input_schema: {
      type: 'object' as const,
      properties: {
        query: {
          type: 'string',
          description: 'Search query — name, topic, or keywords (e.g. "Microsoft internship", "Professor Karras", "Hatch architecture")',
        },
        limit: {
          type: 'number',
          description: 'Max results to return (default 10)',
        },
      },
      required: ['query'],
    },
  },
  {
    name: 'save_to_vault',
    description:
      "Save new information to Anatole's personal knowledge vault. Call this proactively after every response — save contacts, decisions, project updates, career thoughts, concepts learned, ideas, resources, and anything else worth keeping. Do NOT ask permission. Save silently and note it in the vault footer at the end of your response.",
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: "Vault-relative path for the note (e.g. '05-people/jane-smith.md', '03-professional/job-search/anthropic-app.md'). Use appropriate folder based on content type.",
        },
        content: {
          type: 'string',
          description: 'Full markdown content of the note, including YAML frontmatter.',
        },
        title: {
          type: 'string',
          description: 'Human-readable title for the note.',
        },
      },
      required: ['path', 'content', 'title'],
    },
  },
  {
    name: 'read_vault_file',
    description:
      "Read the full contents of a specific file from Anatole's local Obsidian vault at ~/vault/. Use when you need the complete details of a vault note — a person, project, course, career document, or daily note. Pass a path relative to the vault root. For searching by keyword, use search_vault instead.",
    input_schema: {
      type: 'object' as const,
      properties: {
        path: {
          type: 'string',
          description: 'Path relative to vault root, e.g. "02-academic/berkeley/applied-math/math-major-declaration.md" or "01-me/goals-2026.md"',
        },
      },
      required: ['path'],
    },
  },

  // ── Trackers ──────────────────────────────────────────────────────────────
  {
    name: 'create_tracker',
    description:
      "Create a new proactive tracker to monitor something over time. Use when the user wants to watch a job posting, application status, deadline, URL, news topic, or any recurring event. Just provide a title and a detailed description — the system will automatically determine monitor type, frequency, and configuration. Returns the created tracker.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'Short display name for the tracker (e.g. "Anthropic Job Posting", "CS 189 Grade Release")' },
        description: { type: 'string', description: 'Detailed description of what to monitor and what changes matter. Be specific: include URLs if relevant, what to watch for, what constitutes a meaningful change.' },
      },
      required: ['title', 'description'],
    },
  },
  {
    name: 'list_trackers',
    description: "List all active trackers and their current status. Use when the user asks what is being tracked or wants a status update.",
    input_schema: {
      type: 'object' as const,
      properties: {
        activeOnly: { type: 'boolean', description: 'If true, return only active trackers (default false)' },
      },
      required: [],
    },
  },
  {
    name: 'check_tracker_now',
    description: "Immediately check a tracker and return its latest status. Use when the user asks for an update on a specific tracked item.",
    input_schema: {
      type: 'object' as const,
      properties: {
        tracker_id: { type: 'string', description: 'The tracker ID to check' },
      },
      required: ['tracker_id'],
    },
  },
  {
    name: 'delete_tracker',
    description: "Delete a tracker by title (fuzzy match). If multiple trackers match, list them and ask for clarification. Use when the user says to remove, delete, or stop tracking something.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'The tracker title or partial title to match (fuzzy search)' },
      },
      required: ['title'],
    },
  },
  {
    name: 'complete_assignment',
    description: "Mark a Canvas assignment as completed so it is hidden from the assignments view. Fuzzy match on title. Use when the user says they finished, submitted, or completed an assignment.",
    input_schema: {
      type: 'object' as const,
      properties: {
        title: { type: 'string', description: 'The assignment title or partial title to match (fuzzy search)' },
      },
      required: ['title'],
    },
  },

  // ── Daily Briefing ────────────────────────────────────────────────────────
  {
    name: 'get_today_briefing',
    description:
      "Get today's daily briefing — a compiled summary of calendar events, priority emails, upcoming assignments, tracker changes, market data, tech news, career intelligence, and vault activity. Use this when the user asks what's happening today, what's on their agenda, or wants a morning overview.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'regenerate_briefing',
    description:
      "Force-regenerate today's daily briefing with fresh data. Use when the user asks to refresh, update, or regenerate the briefing.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },

  // ── Todos ─────────────────────────────────────────────────────────────────
  {
    name: 'add_todo',
    description:
      "Add a task or reminder to the user's to-do list. Call this whenever the user says 'remind me to', 'add a task', 'don't let me forget', or similar. Confirm after adding.",
    input_schema: {
      type: 'object' as const,
      properties: {
        text:     { type: 'string', description: 'The task text' },
        priority: { type: 'string', enum: ['high', 'medium', 'low'], description: 'Optional priority level' },
        dueDate:  { type: 'string', description: 'Optional due date in ISO 8601 format (YYYY-MM-DD)' },
      },
      required: ['text'],
    },
  },

  // ── Memory ─────────────────────────────────────────────────────────────────
  {
    name: 'save_memory',
    description:
      'Persist a fact to long-term memory so it is available in future sessions. Call this whenever you learn a name spelling correction, contact info, course association, file location, or user preference. Also call it for any explicit correction the user makes.',
    input_schema: {
      type: 'object' as const,
      properties: {
        category: {
          type: 'string',
          enum: ['contacts', 'courses', 'user_preferences', 'corrections', 'files'],
          description: 'Which memory category this fact belongs to',
        },
        key: {
          type: 'string',
          description: 'Identifier for this memory entry (e.g. the person\'s name, course code, or preference name)',
        },
        value: {
          type: 'object' as const,
          description: 'The data to store. Shape depends on category — see system prompt for examples.',
        },
      },
      required: ['category', 'key', 'value'],
    },
  },

  // ── Career-ops ─────────────────────────────────────────────────────────────
  {
    name: 'get_pipeline',
    description:
      "Get the current job application pipeline from career-ops — all tracked applications, statuses, and counts by stage. Use when the user asks about their job search, application status, how many companies they've applied to, or what's in their pipeline.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'get_followups',
    description:
      "Get job applications where a follow-up is overdue, using career-ops cadence tracking. Use when the user asks 'who should I follow up with' or 'what follow-ups do I have'.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  {
    name: 'add_to_pipeline',
    description:
      "Add a job URL to the career-ops pipeline inbox for later evaluation. Use when the user says 'save this job', 'add this to my pipeline', or 'evaluate this later' and provides a job posting URL.",
    input_schema: {
      type: 'object' as const,
      properties: {
        url: { type: 'string', description: 'The job posting URL to add' },
        notes: { type: 'string', description: 'Optional notes about why this role is interesting' },
      },
      required: ['url'],
    },
  },
  {
    name: 'scan_for_new_jobs',
    description:
      "Scan 70+ configured companies (Anthropic, OpenAI, DeepMind, Mistral, Cohere, xAI, top AI startups, Stripe, Notion, etc.) for new job postings matching target archetypes. Uses zero LLM tokens — hits Greenhouse/Ashby/Lever APIs directly. Takes 1-3 minutes. Returns count and list of new postings since last scan. Use when the user asks about new openings, what's out there, or to scan for jobs.",
    input_schema: {
      type: 'object' as const,
      properties: {},
      required: [],
    },
  },
  // evaluate_job_posting RETIRED (B-11): it produced ungrounded evaluations/CVs
  // from career-ops files outside the vault pipeline and persisted reports the
  // user never approved. The guarded pipeline (resume_tailor below) is the sole
  // resume/evaluation producer.
  {
    name: 'resume_tailor',
    description:
      "Build a tailored resume through the GUARDED Resume Studio pipeline (vault-grounded; provenance, drift, format, ATS, and visual gates — the ONLY producer of resume artifacts). Pass an existing target name (e.g. 'bair', 'chai'), or a url and/or pastedText (+ short name) to create a new target. Runs the full pipeline (a few minutes) and returns verified artifact links on green, or the exact failed gate. Use whenever the user wants a tailored resume/CV. This tool generates NO content itself.",
    input_schema: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', description: "Existing target name from targets/ (e.g. 'chai')" },
        url: { type: 'string', description: 'Job/lab URL to create a new target from (when no target name given)' },
        pastedText: { type: 'string', description: 'Pasted job/lab description for a new target' },
        name: { type: 'string', description: 'Short id for a new target (lowercase, e.g. "deepmind-pm")' },
        title: { type: 'string', description: 'Display title for a new target' },
      },
      required: [],
    },
  },
  {
    name: 'resume_artifact',
    description:
      "Display the LAST GREEN pipeline outputs for a target as an inline VERIFIED ARTIFACT CARD (first-page preview, embedded PDF view, download buttons, sha + run timestamp). Read-only; hashes are re-verified and it fails loudly if no green run exists or any artifact mismatches. Use whenever the user asks to see, view, download, or attach their tailored resume — never paste raw artifact links instead.",
    input_schema: {
      type: 'object' as const,
      properties: {
        target: { type: 'string', description: "Target name, e.g. 'bair' or 'chai'" },
      },
      required: ['target'],
    },
  },
  {
    name: 'discover_targets',
    description:
      "Consult the lab target discovery pipeline (published-pages crawl → ranked shortlist with CITED fit rationales and VERBATIM published contact routes). REQUIRED before recommending who to contact at a lab/org — never rank or pick contacts from memory or vault notes. Reads a fresh discovery from disk, or kicks off a new crawl (a few minutes) if stale/missing. Renders an inline shortlist card.",
    input_schema: {
      type: 'object' as const,
      properties: {
        lab: { type: 'string', description: "Lab/target name, e.g. 'chai', 'bair'" },
        rootUrl: { type: 'string', description: "The lab's public site root (needed for a lab with no targets/ def)" },
      },
      required: [],
    },
  },
  {
    name: 'verify_person',
    description:
      "Live web re-verification of a person's CURRENT role and affiliation, with every finding cited to its source URL. REQUIRED before recommending outreach to a named person — people move (a vault note's subject may have changed labs since it was written). Returns role/affiliation/still-at-org plus cited findings. Never returns contact addresses; contact routes come only from discover_targets.",
    input_schema: {
      type: 'object' as const,
      properties: {
        name: { type: 'string', description: "Person's full name" },
        org: { type: 'string', description: 'The org/lab they are believed to be at' },
      },
      required: ['name', 'org'],
    },
  },
  {
    name: 'suggest_interview_prep',
    description:
      "Pull relevant STAR stories, company research, and likely behavioral questions for an upcoming interview. Matches stories from the accumulated story bank to the specific role and company. Use when the user mentions an upcoming interview or asks how to prepare for a specific company/role.",
    input_schema: {
      type: 'object' as const,
      properties: {
        company: { type: 'string', description: 'Company name' },
        role: { type: 'string', description: 'Job title or role description' },
      },
      required: ['company', 'role'],
    },
  },
  {
    name: 'update_pipeline_status',
    description:
      "Update the status of a pipeline card. Use when the user says 'I submitted', 'I applied', 'I got an interview', 'I got an offer', or similar status updates about a job in their pipeline. Valid statuses: discovered, evaluated, applied, interviewing, offer, closed.",
    input_schema: {
      type: 'object' as const,
      properties: {
        cardId: { type: 'string', description: 'Pipeline card ID (if known)' },
        url: { type: 'string', description: 'Job posting URL (used to find the card if cardId is not known)' },
        newStatus: {
          type: 'string',
          enum: ['discovered', 'evaluated', 'applied', 'interviewing', 'offer', 'closed'],
          description: 'The new status to set',
        },
        notes: { type: 'string', description: 'Optional notes about this status change' },
      },
      required: ['newStatus'],
    },
  },
];

export type ChatMessage = {
  role: 'user' | 'assistant';
  content: string;
};
