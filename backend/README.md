# Interview Analyzer - Backend API

Backend service for analyzing PM interview transcripts using Claude Agent SDK.

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
  - `interviewType` (string, optional): Interview type (default: "google-apm")

**Response:**
```json
{
  "success": true,
  "analysis": "... detailed analysis markdown ...",
  "metadata": {
    "interviewType": "google-apm",
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
- `PORT` (optional): Server port (default: 3001)
- `NODE_ENV` (optional): Environment (development/production)
- `ALLOWED_ORIGINS` (optional): CORS allowed origins

## Architecture

- **Express** - Web server framework
- **Claude Agent SDK** - AI agent for autonomous interview analysis
- **Multer** - File upload handling
- **TypeScript** - Type-safe development

## Cost Estimates

Approximate API costs per analysis:
- Small transcript (10 min): ~$0.10
- Medium transcript (30 min): ~$0.30
- Large transcript (60 min): ~$0.50

The Agent SDK performs multiple operations:
1. Web search for current interview criteria
2. Transcript analysis with detailed evaluation
3. Self-review for quality assurance
