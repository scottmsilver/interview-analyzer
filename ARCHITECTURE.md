# Interview Analyzer - Architecture & How It Works

## Overview
Interview Analyzer is a full-stack web application that analyzes PM interview transcripts using AI to provide structured feedback. The system consists of a React frontend, Python FastAPI backend, and uses Firebase for authentication, storage, and hosting.

## System Architecture

```
┌─────────────────┐     ┌──────────────────┐     ┌──────────────────┐
│                 │────▶│                  │────▶│                  │
│  React Frontend │     │  FastAPI Backend │     │  OpenAI API      │
│   (Firebase)    │◀────│   (Cloud Run)    │◀────│                  │
└─────────────────┘     └──────────────────┘     └──────────────────┘
        │                        │
        │                        │
        ▼                        ▼
┌─────────────────┐     ┌──────────────────┐
│                 │     │                  │
│  Firebase Auth  │     │  Firestore DB    │
│                 │     │                  │
└─────────────────┘     └──────────────────┘
```

## Frontend Architecture

### Tech Stack
- **React** with TypeScript
- **Vite** for build tooling
- **Firebase SDK** for authentication and Firestore
- **React Router** for navigation
- **React Markdown** for rendering analysis results

### Key Components

#### 1. Authentication Flow (`Login.tsx`)
- Google OAuth authentication via Firebase Auth
- User approval system - new users need admin approval
- Stores user data in Firestore `userApprovals` collection

#### 2. Main Analysis Interface (`App.tsx`)
**Features:**
- Interview type selector (Google APM, Meta PM, Amazon PM, Generic PM)
- Two input methods:
  - File upload (.txt files)
  - Paste dialog for direct text input
- Real-time analysis with streaming logs
- Auto-save functionality after analysis completes
- Automatic navigation to saved analysis view

**Key Functions:**
- `analyzeInterview()`: Sends transcript to backend API
- `saveAnalysis()`: Stores results in Firestore
- `handlePasteSubmit()`: Converts pasted text to File object

#### 3. Analysis View (`AnalysisView.tsx`)
- Displays saved analyses with formatted markdown
- Share functionality with link copying
- Copy analysis to clipboard
- Responsive design with mobile support

#### 4. History View (`History.tsx`)
- Lists all saved analyses for the user
- Sortable by date
- Click to view full analysis

#### 5. Admin Panel (`Admin.tsx`)
- User approval management
- View all pending and approved users
- One-click approval/rejection

### State Management
- Local React state with useState hooks
- Real-time Firestore listeners for user approval status
- Auto-save state tracking to prevent duplicate saves

### Styling Architecture
- Component-specific CSS files
- Mobile-first responsive design
- Toast notifications for user feedback
- Elegant, minimal UI with subtle animations

## Backend Architecture

### Tech Stack
- **FastAPI** (Python)
- **OpenAI API** for analysis
- **Anthropic Claude API** as fallback
- **Cloud Run** for serverless deployment

### API Endpoints

#### `POST /analyze`
**Purpose:** Analyze interview transcript

**Request Body:**
```json
{
  "transcript": "string",
  "interview_type": "google-apm | meta-pm | amazon-pm | generic"
}
```

**Response:** Server-sent events (SSE) stream with:
- Agent logs during processing
- Final analysis in markdown format

**Processing Flow:**
1. Receives transcript and interview type
2. Selects appropriate prompt template
3. Streams to OpenAI API (or Claude as fallback)
4. Returns structured feedback with:
   - Strengths
   - Areas for improvement
   - Specific recommendations
   - Overall assessment

### Interview Type Prompts
Each interview type has a customized prompt focusing on:
- **Google APM**: Product sense, analytical thinking, creativity
- **Meta PM**: Execution, metrics, user empathy
- **Amazon PM**: Customer obsession, data-driven decisions, leadership principles
- **Generic PM**: Balanced assessment across all PM competencies

## Database Schema

### Firestore Collections

#### `userApprovals`
```javascript
{
  uid: "string",           // Firebase Auth UID
  email: "string",
  approved: boolean,
  createdAt: "timestamp",
  approvedAt: "timestamp"  // Optional
}
```

#### `analyses`
```javascript
{
  userId: "string",              // Owner's UID
  interviewType: "string",       // Interview type selected
  transcriptFileName: "string",
  analysis: "string",            // Markdown analysis
  title: "string",               // Display title
  savedAt: "string",             // Human-readable timestamp
  createdAt: "ISO string",
  updatedAt: "ISO string"
}
```

## Deployment Architecture

### Frontend Deployment
- **Firebase Hosting**: Static site hosting
- **Environment Variables**:
  - `.env.development`: Local development config
  - `.env.production`: Production Firebase config
- **Build Process**:
  ```bash
  npm run build  # Vite production build
  firebase deploy --only hosting
  ```

### Backend Deployment
- **Cloud Run**: Serverless container platform
- **Docker Container**: FastAPI application
- **Environment Variables**:
  - `OPENAI_API_KEY`: OpenAI API authentication
  - `ANTHROPIC_API_KEY`: Claude API backup
- **CORS Configuration**: Allows requests from Firebase hosting domain

## Security Features

1. **Authentication Required**: All features require login
2. **User Approval System**: Admin must approve new users
3. **Data Isolation**: Users only see their own analyses
4. **API Key Protection**: Backend handles all AI API calls
5. **CORS Protection**: Only allows requests from approved domains

## User Experience Features

### Toast Notifications
- Minimal, elegant notifications
- Auto-dismiss after 3 seconds
- Positioned at top of screen
- Concise messages ("✓ Copied", "✓ Saved")

### Mobile Responsiveness
- Adaptive header with wrapped navigation
- Stacked buttons on small screens
- Touch-friendly interface
- Optimized font sizes and padding

### Auto-Save Flow
1. Analysis completes
2. Wait 1 second for user to see results
3. Auto-save to Firestore
4. Show brief success message
5. Navigate to saved analysis view

### Input Methods
- **File Upload**: Traditional file picker
- **Paste Dialog**: Quick text input
- Both create standardized File objects for processing

## Performance Optimizations

1. **Streaming Responses**: Real-time feedback during analysis
2. **Lazy Loading**: Components load as needed
3. **Optimistic UI**: Immediate feedback for user actions
4. **Efficient Re-renders**: Minimal state updates

## Error Handling

- Network errors show user-friendly messages
- Fallback to Claude API if OpenAI fails
- Validation for file types and content
- Graceful handling of auth failures

## Development Workflow

### Local Development
```bash
# Frontend
cd frontend
npm install
npm run dev  # Starts on localhost:5173

# Backend
cd backend
pip install -r requirements.txt
python main.py  # Starts on localhost:3001
```

### Production Deployment
```bash
# Frontend
npm run build
firebase deploy --only hosting

# Backend (via Cloud Run)
gcloud run deploy interview-analyzer-api \
  --source . \
  --region us-central1
```

## Future Enhancements

1. **Batch Analysis**: Process multiple interviews
2. **Export Options**: PDF, DOCX formats
3. **Comparison View**: Side-by-side analyses
4. **Custom Rubrics**: User-defined evaluation criteria
5. **Team Features**: Shared analyses for interview teams
