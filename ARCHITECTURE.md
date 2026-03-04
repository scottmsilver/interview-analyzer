# Architecture

## System Overview

Interview Analyzer is a web application that analyzes interview transcripts using Claude. Users upload transcripts, select an interview type, and receive detailed AI-generated feedback with scores, strengths, weaknesses, and recommendations.

```
┌─────────────────────────────────────────────────────────────────┐
│                        User Browser                             │
│  ┌───────────────────────────────────────────────────────────┐  │
│  │              React SPA (Vite + TypeScript)                │  │
│  └─────────────────────────┬─────────────────────────────────┘  │
└─────────────────────────────┼───────────────────────────────────┘
                              │ HTTPS
              ┌───────────────┴───────────────┐
              │                               │
              ▼                               ▼
     ┌────────────────┐             ┌──────────────────┐
     │  Firebase       │             │  Express Backend  │
     │                │             │  (Fly.io)         │
     │  - Auth        │             └────────┬─────────┘
     │  - Firestore   │                      │
     │  - Functions   │          ┌───────────┼───────────┐
     └────────────────┘          │           │           │
                                 ▼           ▼           ▼
                          ┌──────────┐ ┌──────────┐ ┌──────────┐
                          │Anthropic │ │  Brave   │ │ Firebase │
                          │  Claude  │ │ Search   │ │ Admin SDK│
                          └──────────┘ └──────────┘ └──────────┘
```

## Technology Stack

| Layer | Technology |
|-------|-----------|
| Frontend | React 19 + TypeScript, Vite |
| Routing | React Router v7 |
| Backend | Node.js + Express + TypeScript |
| AI | Anthropic Claude (claude-opus-4-5) |
| Database | Firebase Firestore |
| Authentication | Firebase Auth (Google OAuth) |
| Email | Gmail API via Cloud Functions |
| Web Search | Brave Search API |
| Deployment | Fly.io (frontend + backend) |
| CI/CD | GitHub Actions |

## Frontend

### Routes

| Path | Component | Description |
|------|-----------|-------------|
| `/login` | Login | Google OAuth sign-in |
| `/` | MainContent | Upload transcript, select type, run analysis |
| `/analysis/:id` | AnalysisView | View analysis with share controls |
| `/shared/:shareId` | SharedView | Public/permissioned shared view |
| `/history` | History | Sortable table of past analyses |
| `/admin` | Admin | User management, invites, interview types, logs |

### Component Hierarchy

```
Router
├── SharedView (standalone, no auth required)
└── Layout (authenticated)
    ├── Header (nav tabs, user menu)
    └── Outlet
        ├── MainContent (upload + analysis)
        ├── AnalysisView (view + share)
        ├── History (TanStack React Table)
        └── Admin
            ├── Gmail OAuth management
            ├── User approval
            ├── Invite management
            ├── Interview type CRUD
            └── Cloud Function logs
```

### Key Source Files

| File | Purpose |
|------|---------|
| `App.tsx` | Router, auth context, main upload/analysis UI |
| `api.ts` | Firebase client, Firestore operations, auth helpers |
| `AnalysisView.tsx` | Analysis display with markdown, sharing, transcript viewer |
| `SharedView.tsx` | Permission-enforced shared analysis view |
| `History.tsx` | Analysis history with sortable table |
| `Admin.tsx` | Admin panel (users, invites, types, logs, Gmail) |
| `Login.tsx` | Google OAuth sign-in page |
| `Layout.tsx` | Authenticated layout wrapper with header |
| `Header.tsx` | Navigation and user profile menu |
| `components.tsx` | Shared components (Toast, Loading, ErrorBox, AnalysisMarkdown) |
| `hooks.ts` | Custom hooks (useToast, useCopyToClipboard) |
| `types.ts` | TypeScript types and fallback interview type list |

### Sharing System

Three share modes for analyses:
- **Private** — owner only (default)
- **Anyone** — public via 12-character share link
- **Specific** — email whitelist

## Backend

### API Endpoints

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/health` | None | Health check |
| GET | `/api/interview-types` | None | Fallback interview types |
| POST | `/api/analyze/stream` | None | Streaming analysis (SSE) |
| POST | `/api/analyze` | None | Non-streaming analysis |
| POST | `/api/admin/refresh-criteria` | Admin key | Refresh criteria cache |
| GET | `/api/admin/criteria-cache` | Admin key | View cached criteria |

### Analysis Engine

Two methods available (selected by `method` form field):

**Direct API (default, fast):**
1. Builds prompt from interview type name + cached criteria
2. Calls Claude API with optional web search tool
3. Tool-use loop (max 3 search calls) if no cached criteria
4. Returns streaming SSE events

**Agent SDK (thorough):**
1. Uses `@anthropic-ai/claude-agent-sdk`
2. Built-in web search, up to 20 turns
3. More comprehensive but slower

Both methods produce:
- Per-question evaluation with scores (1-10) and timestamps
- Overall assessment with pass/fail verdict
- 5-7 actionable recommendations
- Markdown-formatted output

### Criteria System

Interview evaluation criteria come from three sources (in priority order):

1. **Admin-defined criteria** — stored in Firestore `interviewTypes` collection, sent as `cachedCriteria` by the frontend
2. **Web search cache** — Firestore `interviewCriteria` collection, refreshable via admin endpoint
3. **Dynamic research** — if no cached criteria, the AI does live web search during analysis

### Key Source Files

| File | Purpose |
|------|---------|
| `server.ts` | Express app, routes, CORS, file upload (Multer) |
| `analyzer.ts` | Analysis engine (Agent SDK + Direct API methods) |
| `criteria-cache.ts` | Firestore criteria caching and web research |
| `firebase-admin.ts` | Firebase Admin SDK initialization |

## Data Model (Firestore)

### Collections

```
analyses/{analysisId}
  ├── userId: string
  ├── interviewType: string
  ├── transcriptFileName: string
  ├── transcriptContent: string
  ├── analysis: string (markdown)
  ├── title: string
  ├── createdAt: string
  ├── shareId?: string
  ├── shareMode?: 'private' | 'anyone' | 'specific'
  └── sharedWith?: string[]

users/{userId}
  ├── email: string
  ├── approved: boolean
  ├── createdAt: string
  └── approvedAt?: string

interviewTypes/{typeId}
  ├── name: string
  ├── criteria: string
  ├── createdAt: timestamp
  └── updatedAt: timestamp

interviewCriteria/{typeId}
  ├── interviewType: string
  ├── criteria: string
  ├── lastUpdated: timestamp
  └── source: 'web-search' | 'manual'

invites/{inviteId}
  ├── email: string
  ├── invitedBy: string
  ├── status: 'pending' | 'accepted'
  └── createdAt: timestamp

admins/{userId}
  ├── email: string
  ├── gmailRefreshToken?: string
  └── gmailAuthorizedAt?: string

config/admins
  └── emails: string[]
```

### Indexes

- `analyses`: userId (ASC) + createdAt (DESC)
- `invites`: status (ASC) + createdAt (DESC)
- `invites`: email (ASC) + status (ASC)

## Cloud Functions

Firebase Cloud Functions handle email workflows:

| Function | Trigger | Purpose |
|----------|---------|---------|
| `authorizeGmail` | HTTP | Initiates Gmail OAuth for admin |
| `gmailOAuthCallback` | HTTP | Stores OAuth tokens |
| `sendApprovalEmail` | Firestore (users create) | Emails admin when new user signs up |
| `approveUser` | HTTP | Approves user via email link |
| `sendInviteEmail` | Firestore (invites create) | Sends invite emails |
| `refreshGmailTokens` | Scheduled (weekly) | Refreshes OAuth tokens |
| `fetchLogs` | HTTP | Returns Cloud Function logs |

## Analysis Data Flow

```
1. User selects interview type and uploads transcript
                    │
2. Frontend fetches cached criteria from Firestore
   (interviewTypes collection, admin-defined)
                    │
3. POST /api/analyze/stream
   Body: transcript file, interviewType, cachedCriteria, method
                    │
4. Backend builds prompt:
   "You are an expert interviewer evaluating a
    candidate for a ${interviewType} role..."
   + criteria section (from cache or web search)
   + workflow steps
                    │
5. Claude API call (streaming)
   ├── If no cached criteria: web search via Brave API
   └── Analyze transcript, score questions, assess overall
                    │
6. SSE events streamed to frontend
   Types: start → raw (progress) → result (markdown) → complete
                    │
7. Frontend renders markdown progressively
                    │
8. Auto-save analysis to Firestore
```

## Authentication Flow

```
1. User clicks "Sign in with Google"
                    │
2. Firebase Auth handles Google OAuth
                    │
3. On first sign-in: user doc created in Firestore (approved: false)
                    │
4. Cloud Function triggers:
   ├── If valid invite exists → auto-approve
   └── Otherwise → email admin for approval
                    │
5. Frontend subscribes to user doc (real-time)
   └── When approved: true → show main app
```

## Deployment

### Fly.io

| Service | App Name | Region | Resources |
|---------|----------|--------|-----------|
| Backend | interview-analyzer-api | sjc | 512MB RAM, 1 shared CPU |
| Frontend | interview-analyzer-web | sjc | 256MB RAM, 1 shared CPU |

Both use auto-stop/auto-start with 0 minimum machines.

**Backend** — Node.js Docker container (node:20-slim), port 8080
**Frontend** — Nginx Alpine serving Vite build output, port 8080

### Firebase

- **Firestore** — document database (rules in `firestore.rules`)
- **Auth** — Google OAuth provider
- **Cloud Functions** — us-central1, Gmail integration

### CI/CD (GitHub Actions)

Triggered on push/PR to main or develop:
1. Frontend build + lint
2. Backend build + lint + test
3. Security check (no .env files, no hardcoded keys/URLs)

## Environment Variables

### Backend

| Variable | Required | Description |
|----------|----------|-------------|
| ANTHROPIC_API_KEY | Yes | Claude API key |
| PORT | No | Server port (default: 9002) |
| NODE_ENV | No | Environment mode |
| ADMIN_API_KEY | No | Admin endpoint auth |
| BRAVE_API_KEY | No | Brave Search for criteria research |
| FIREBASE_SERVICE_ACCOUNT_JSON | No | Firebase credentials (Fly.io) |
| ALLOWED_ORIGINS | No | CORS origins (comma-separated) |

### Frontend (build-time)

| Variable | Description |
|----------|-------------|
| VITE_API_URL | Backend API URL |
| VITE_FIREBASE_API_KEY | Firebase client API key |
| VITE_FIREBASE_AUTH_DOMAIN | Firebase auth domain |
| VITE_FIREBASE_PROJECT_ID | Firebase project ID |
| VITE_FIREBASE_STORAGE_BUCKET | Firebase storage bucket |
| VITE_FIREBASE_MESSAGING_SENDER_ID | Firebase sender ID |
| VITE_FIREBASE_APP_ID | Firebase app ID |

### Cloud Functions

| Variable | Description |
|----------|-------------|
| GMAIL_OAUTH_CLIENT_ID | Google OAuth client ID |
| GMAIL_OAUTH_CLIENT_SECRET | Google OAuth client secret |

---

Last Updated: March 2026
