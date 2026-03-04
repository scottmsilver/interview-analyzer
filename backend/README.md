# Interview Analyzer - Backend API

Backend service for analyzing interview transcripts using Claude API.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment variables:**
   ```bash
   cp .env.example .env
   ```

   Then edit `.env` and add your Anthropic API key:
   ```
   ANTHROPIC_API_KEY=your_api_key_here
   ```

   Get your API key from: https://console.anthropic.com/

3. **Run in development mode:**
   ```bash
   npm run dev
   ```

4. **Build for production:**
   ```bash
   npm run build
   npm start
   ```

## Testing

Test the analyzer directly with a transcript file:

```bash
npm test
```

This will analyze the transcript file located at `../../transcript`.

## API Endpoints

### `GET /health`
Health check endpoint.

**Response:**
```json
{
  "status": "healthy",
  "timestamp": "2025-11-11T12:00:00.000Z",
  "apiKeyConfigured": true
}
```

### `GET /api/interview-types`
Get list of supported interview types.

**Response:**
```json
{
  "types": [
    { "id": "google-apm", "name": "Google APM", "description": "..." },
    { "id": "meta-pm", "name": "Meta PM", "description": "..." }
  ]
}
```

### `POST /api/analyze`
Analyze an interview transcript (non-streaming).

**Request:**
- Method: `POST`
- Content-Type: `multipart/form-data`
- Body:
  - `transcript` (file): The transcript file (.txt)
  - `interviewType` (string, optional): Interview type (default: "generic")
  - `cachedCriteria` (string, optional): Pre-fetched evaluation criteria

**Response:**
```json
{
  "success": true,
  "analysis": "... detailed analysis markdown ...",
  "metadata": {
    "interviewType": "generic",
    "transcriptLength": 59231,
    "analyzedAt": "2025-11-11T12:00:00.000Z"
  }
}
```

### `POST /api/analyze/stream`
Analyze an interview transcript with real-time streaming (recommended).

**Request:**
- Same as `/api/analyze`

**Response:**
- Server-Sent Events (SSE) stream
- Each event is JSON: `{ "type": "...", "content": "...", "timestamp": "..." }`

## Environment Variables

- `ANTHROPIC_API_KEY` (required): Your Anthropic API key
- `PORT` (optional): Server port (default: 9002)
- `NODE_ENV` (optional): Environment (development/production)
- `ALLOWED_ORIGINS` (optional): CORS allowed origins

## Architecture

- **Express** - Web server framework
- **Claude API** - AI-powered interview analysis
- **Multer** - File upload handling
- **TypeScript** - Type-safe development
- **Firebase Admin** - Authentication and data storage

The analysis engine supports any interview type — evaluation criteria are loaded dynamically from admin-defined types in Firestore or via web search.
