# Hatch — Product Vision

## Current: Web Dashboard (MVP)
Personal AI secretary accessible via localhost. Chat, email, drive, assignments, knowledge base.

## Next: Desktop App (Electron/Tauri)
Package Hatch as a native desktop app. System tray icon, global hotkey (Cmd+Shift+A) 
to summon from anywhere. Persistent background process that syncs and monitors.

## Startup Vision: Pervasive Desktop Layer
Hatch becomes an invisible, always-present AI layer on your computer:

- **Thin overlay** — translucent command bar that slides down from the top of 
  any screen on hotkey, like Spotlight but for actions not just search
- **Screen awareness** — can see what app you're in and offer contextual actions 
  ("I see you're on LinkedIn — want me to save this job posting?")
- **Universal clipboard intelligence** — copy a job description, Hatch auto-offers 
  to tailor your resume. Copy an email address, Hatch offers to draft a message.
- **Notification layer** — subtle, non-intrusive notifications that float above 
  all apps: "Assignment due in 4 hours", "New email from recruiter — looks urgent"
- **Cross-app orchestration** — "Take the data from this spreadsheet, put it in 
  a slide deck, and email it to my team" — Hatch handles the entire pipeline
- **Background agents** — always-running watchers for job postings, email patterns, 
  calendar conflicts, assignment deadlines, news relevant to your interests
- **Voice-first** — "Hey Hatch" wake word, conversational task execution while 
  you keep working

### Technical Path
1. Web app (current) → prove the AI secretary concept
2. Electron/Tauri wrapper → native desktop app with system tray
3. Accessibility APIs + screen capture → context awareness
4. OS-level integration → global overlay, clipboard hooks, notification system
5. Mobile companion app → manage Hatch from your phone

### Competitive Moat
- Deep personal context (email history, writing style, contact graph, academic/career data)
- Not a general-purpose agent — purpose-built for ambitious students and young professionals
- Network effects: the more you use it, the better it knows you, the harder to leave
- Potential B2B: sell to universities as a student success platform

### UI Direction for Startup
- Glassmorphism / frosted glass aesthetic for the overlay
- Minimal, almost invisible when idle — maximally useful when summoned
- Feels like a luxury product, not a productivity tool
- Animation-rich: smooth spring physics, fluid transitions
- Dark mode default with adaptive theming

### Comparable Products to Study
- Raycast (command palette UX)
- Rewind.ai (background recording + search)
- Notion AI (knowledge base + assistant)  
- Rabbit R1 / Humane Pin (ambient AI concept, bad execution)
- Claude Cowork (desktop agent, general purpose — Hatch is personal + specific)
