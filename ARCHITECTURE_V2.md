# System Architecture Documentation

## Table of Contents
- [Overview](#overview)
- [System Design](#system-design)
- [Frontend Architecture](#frontend-architecture)
- [Backend Architecture](#backend-architecture)
- [Data Flow](#data-flow)
- [Security Architecture](#security-architecture)
- [Deployment Architecture](#deployment-architecture)
- [Performance Architecture](#performance-architecture)
- [Scalability Considerations](#scalability-considerations)

## Overview

The Interview Analyzer is a modern, cloud-native web application built with separation of concerns, scalability, and user experience at its core. It leverages AI for intelligent analysis while maintaining security and performance.

### Key Architectural Decisions
- **Serverless Backend**: Scalable, cost-effective
- **Streaming Responses**: Real-time user feedback
- **Firebase Ecosystem**: Integrated auth, database, and hosting
- **Component-Based Frontend**: Maintainable and testable
- **Event-Driven Communication**: Loosely coupled systems

## System Design

### High-Level Architecture

```
┌──────────────────────────────────────────────────────────────┐
│                         User Browser                         │
│  ┌──────────────────────────────────────────────────────┐   │
│  │                   React SPA (Vite)                    │   │
│  └──────────────────────────────────────────────────────┘   │
└───────────────────────────┬──────────────────────────────────┘
                            │ HTTPS
        ┌───────────────────┴───────────────────┐
        │                                       │
        ▼                                       ▼
┌──────────────┐                    ┌──────────────────┐
│   Firebase   │                    │  Express/FastAPI │
│   Services   │                    │    Backend       │
│              │                    │  (Cloud Run)     │
│  - Auth      │                    └────────┬─────────┘
│  - Firestore │                             │
│  - Hosting   │                             ▼
└──────────────┘                    ┌──────────────────┐
                                     │  Anthropic API  │
                                     │  (Claude 3.5)   │
                                     └──────────────────┘
```

### Technology Stack

| Layer | Technology | Purpose |
|-------|------------|---------|
| Frontend | React 18 + TypeScript | UI Components |
| Build Tool | Vite | Fast development & optimized builds |
| State Management | React Hooks | Local state management |
| Routing | React Router v6 | Client-side routing |
| Styling | CSS Modules | Component-scoped styles |
| Authentication | Firebase Auth | User management |
| Database | Firestore | Document storage |
| Backend | Node.js/Express | API server |
| AI Integration | Anthropic SDK | Claude integration |
| Deployment | Firebase Hosting | Frontend hosting |
| Backend Deploy | Cloud Run/Heroku | Serverless backend |

## Frontend Architecture

### Component Hierarchy

```
App.tsx
├── Layout.tsx
│   ├── Navigation
│   └── Footer
├── Login.tsx
│   └── GoogleAuthButton
├── MainView (Analysis)
│   ├── FileUpload
│   ├── PasteDialog
│   ├── InterviewTypeSelector
│   ├── AnalysisDisplay
│   └── AgentStatusWindow
├── History.tsx
│   └── AnalysisTable (TanStack)
├── AnalysisView.tsx
│   ├── MarkdownRenderer
│   ├── TranscriptDialog
│   └── ShareButtons
└── Admin.tsx
    ├── GmailSection
    └── UsersTable
```

### State Management Pattern

```typescript
// Component State Pattern
const [state, setState] = useState<StateType>()

// Effect Pattern for Side Effects
useEffect(() => {
  // Subscription/API calls
  return () => {
    // Cleanup
  }
}, [dependencies])

// Custom Hook Pattern
function useAnalysis() {
  const [analysis, setAnalysis] = useState()
  const [loading, setLoading] = useState(false)
  // Logic here
  return { analysis, loading }
}
```

### Routing Structure

```typescript
<Routes>
  <Route path="/" element={<App />} />
  <Route path="/history" element={<History />} />
  <Route path="/analysis/:id" element={<AnalysisView />} />
  <Route path="/admin" element={<Admin />} />
</Routes>
```

### CSS Architecture

```css
/* Design System Variables */
:root {
  --primary-500: #c77a4b;
  --sage-500: #738c5f;
  --accent-gold: #d4a574;
  /* ... */
}

/* Component Styles */
.component-name {
  /* BEM-like naming */
}

/* Responsive Design */
@media (max-width: 768px) {
  /* Mobile styles */
}
```

## Backend Architecture

### API Design

```
POST /api/analyze/stream
├── Headers: Content-Type: multipart/form-data
├── Body: transcript (file), interviewType (string)
└── Response: Server-Sent Events (SSE)

GET /api/health
└── Response: { status: 'ok' }
```

### Streaming Architecture

```javascript
// SSE Implementation
async function* analyzeStream(transcript, type) {
  yield { type: 'status', content: 'Initializing...' }

  const agent = new AnthropicAgent()

  for await (const chunk of agent.analyze(transcript)) {
    yield { type: 'result', content: chunk }
  }

  yield { type: 'complete' }
}
```

### Agent Integration

```javascript
class AnalysisAgent {
  constructor() {
    this.client = new Anthropic({
      apiKey: process.env.ANTHROPIC_API_KEY
    })
  }

  async analyze(transcript, interviewType) {
    const systemPrompt = this.getSystemPrompt(interviewType)

    return this.client.messages.create({
      model: "claude-3-5-sonnet-20241022",
      messages: [{ role: "user", content: transcript }],
      system: systemPrompt,
      stream: true
    })
  }
}
```

## Data Flow

### Analysis Flow

```
1. User uploads transcript
   ↓
2. Frontend validates file
   ↓
3. FormData sent to backend
   ↓
4. Backend initializes SSE connection
   ↓
5. Agent analyzes with streaming
   ↓
6. Results streamed to frontend
   ↓
7. Frontend renders progressively
   ↓
8. Analysis auto-saved to Firestore
   ↓
9. User redirected to saved view
```

### Authentication Flow

```
1. User clicks "Sign in with Google"
   ↓
2. Firebase Auth handles OAuth
   ↓
3. User document created/checked
   ↓
4. Admin approval checked
   ↓
5. Access granted/denied
   ↓
6. Real-time approval updates via onSnapshot
```

### Data Models

```typescript
// User Approval
interface UserApproval {
  approved: boolean
  email: string
  createdAt: string
  approvedAt?: string
  approvedBy?: string
}

// Analysis Document
interface Analysis {
  userId: string
  interviewType: string
  transcriptFileName: string
  transcriptContent?: string
  analysis: string
  title: string
  savedAt: string
  createdAt: string
  updatedAt: string
}

// Admin Document
interface Admin {
  email: string
  gmailTokens?: object
  gmailAuthorizedAt?: string
}
```

## Security Architecture

### Authentication & Authorization

```
┌─────────────┐     ┌──────────────┐     ┌─────────────┐
│   Browser   │────▶│   Firebase   │────▶│   Google    │
│             │◀────│     Auth     │◀────│    OAuth    │
└─────────────┘     └──────────────┘     └─────────────┘
       │                    │
       ▼                    ▼
┌─────────────┐     ┌──────────────┐
│  Frontend   │     │  Firestore   │
│   Guards    │     │    Rules     │
└─────────────┘     └──────────────┘
```

### Security Measures

1. **Environment Variables**
   - API keys in `.env` files
   - Never committed to git
   - Separate dev/prod configs

2. **Firebase Security Rules**
   ```javascript
   match /analyses/{document} {
     allow read: if request.auth.uid == resource.data.userId
     allow write: if request.auth.uid == resource.data.userId
   }
   ```

3. **Input Validation**
   - File type checking
   - Size limits
   - Sanitization

4. **CORS Configuration**
   - Whitelist allowed origins
   - Credential handling

## Deployment Architecture

### Frontend Deployment

```bash
# Build Process
npm run build
├── TypeScript compilation
├── Bundle optimization
├── Asset minification
└── Output: dist/

# Firebase Hosting
firebase deploy --only hosting
└── Serves from CDN
```

### Backend Deployment Options

#### Option 1: Cloud Run (Recommended)
```yaml
# cloudbuild.yaml
steps:
  - name: 'gcr.io/cloud-builders/docker'
    args: ['build', '-t', 'IMAGE_URL', '.']
  - name: 'gcr.io/cloud-builders/docker'
    args: ['push', 'IMAGE_URL']
  - name: 'gcr.io/cloud-builders/gcloud'
    args: ['run', 'deploy', 'SERVICE_NAME']
```

#### Option 2: Heroku
```json
// package.json
"scripts": {
  "start": "node server.js",
  "heroku-postbuild": "npm run build"
}
```

### CI/CD Pipeline

```
GitHub Push
    ↓
GitHub Actions
    ↓
├── Run Tests
├── Build Frontend
├── Build Backend
└── Deploy
    ├── Frontend → Firebase
    └── Backend → Cloud Run
```

## Performance Architecture

### Frontend Optimizations

1. **Code Splitting**
   ```typescript
   const Admin = lazy(() => import('./Admin'))
   ```

2. **Bundle Optimization**
   - Tree shaking
   - Minification
   - Compression

3. **Caching Strategy**
   - Service worker
   - Browser cache headers
   - CDN caching

### Backend Optimizations

1. **Streaming Responses**
   - No buffering
   - Progressive rendering
   - Reduced memory usage

2. **Connection Management**
   - Keep-alive connections
   - Connection pooling
   - Timeout management

3. **Rate Limiting**
   ```javascript
   rateLimit({
     windowMs: 15 * 60 * 1000,
     max: 100
   })
   ```

### Database Optimizations

1. **Firestore Indexes**
   ```json
   {
     "indexes": [{
       "collectionGroup": "analyses",
       "queryScope": "COLLECTION",
       "fields": [
         { "fieldPath": "userId", "order": "ASCENDING" },
         { "fieldPath": "createdAt", "order": "DESCENDING" }
       ]
     }]
   }
   ```

2. **Query Optimization**
   - Pagination
   - Field selection
   - Compound queries

## Scalability Considerations

### Horizontal Scaling

```
Load Balancer
     ↓
┌────┴────┬────┬────┐
│ Node 1  │ N2 │ N3 │  Backend Instances
└────┬────┴────┴────┘
     ↓
Shared Services
```

### Vertical Scaling

- **Firebase**: Automatic scaling
- **Cloud Run**: Auto-scaling 0-1000 instances
- **Firestore**: No-ops scaling

### Bottlenecks & Solutions

| Bottleneck | Solution |
|------------|----------|
| AI API Rate Limits | Queue system with retry |
| Database Writes | Batch operations |
| Large Transcripts | Chunking strategy |
| Concurrent Users | CDN & caching |

### Monitoring & Observability

```javascript
// Logging Strategy
logger.info('Analysis started', {
  userId,
  interviewType,
  fileSize,
  timestamp
})

// Metrics Collection
metrics.increment('analysis.started')
metrics.timing('analysis.duration', duration)

// Error Tracking
Sentry.captureException(error, {
  user: { id: userId },
  extra: { interviewType }
})
```

## Development Workflow

### Local Development

```bash
# Frontend
cd frontend
npm install
npm run dev  # Vite dev server at :5173

# Backend
cd backend
npm install
npm run dev  # Nodemon at :3001
```

### Environment Setup

```env
# Frontend .env
VITE_API_URL=http://localhost:3001
VITE_FIREBASE_API_KEY=xxx

# Backend .env
ANTHROPIC_API_KEY=xxx
PORT=3001
```

### Testing Strategy

```typescript
// Unit Tests
describe('AnalysisService', () => {
  it('should parse transcript correctly', () => {
    // Test implementation
  })
})

// Integration Tests
describe('API Endpoints', () => {
  it('should analyze transcript', async () => {
    // Test implementation
  })
})

// E2E Tests
describe('User Flow', () => {
  it('should complete analysis flow', () => {
    // Cypress/Playwright test
  })
})
```

## Disaster Recovery

### Backup Strategy
- Firestore: Automatic backups
- Code: Git version control
- Secrets: Secure vault backup

### Recovery Procedures
1. **Data Loss**: Restore from Firestore backup
2. **Service Outage**: Failover to backup region
3. **Security Breach**: Rotate all keys, audit logs

## Future Architecture Considerations

### Potential Enhancements
1. **Microservices Migration**
   - Separate analysis service
   - Independent scaling
   - Service mesh

2. **Event-Driven Architecture**
   - Message queue (Pub/Sub)
   - Async processing
   - Event sourcing

3. **Multi-Region Deployment**
   - Geographic distribution
   - Reduced latency
   - Improved availability

4. **GraphQL Migration**
   - Flexible queries
   - Reduced overfetching
   - Better typing

## Documentation Standards

### Code Documentation
```typescript
/**
 * Analyzes interview transcript using AI
 * @param transcript - The interview transcript text
 * @param type - Interview type (google-apm, meta-pm, etc)
 * @returns Promise<AnalysisResult>
 */
async function analyzeTranscript(
  transcript: string,
  type: InterviewType
): Promise<AnalysisResult> {
  // Implementation
}
```

### API Documentation
- OpenAPI/Swagger specs
- Postman collections
- README files

## Conclusion

This architecture provides a solid foundation for a scalable, maintainable, and user-friendly interview analysis platform. The separation of concerns, use of modern technologies, and cloud-native approach ensure the system can grow with user needs while maintaining performance and reliability.

Last Updated: November 2024
