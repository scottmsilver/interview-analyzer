# 🎯 PM Interview Analyzer

An AI-powered tool for analyzing Product Manager interview transcripts using the **Claude Agent SDK**. Upload a transcript and get detailed, actionable feedback on your interview performance.

## ✨ Features

- **Autonomous Analysis**: Uses Claude Agent SDK to research current interview standards and provide comprehensive feedback
- **Multiple Interview Types**: Supports Google APM, Meta PM, Amazon PM, and generic PM interviews
- **Real-time Streaming**: Watch the analysis appear in real-time as the AI agent works
- **Detailed Evaluation**: Question-by-question breakdown with timestamps, scores, and specific examples
- **Actionable Recommendations**: Concrete suggestions for improvement
- **Firebase Authentication**: Secure login with email/password or Google OAuth
- **Beautiful UI**: Clean, responsive interface with markdown rendering

## 🏗️ Architecture

```
interview-analyzer/
├── backend/          # Express + Claude Agent SDK
│   ├── src/
│   │   ├── server.ts      # API server
│   │   ├── analyzer.ts    # Core analysis logic
│   │   └── test-analyzer.ts
│   └── package.json
├── frontend/         # React + TypeScript + Vite
│   ├── src/
│   │   ├── App.tsx        # Main component
│   │   └── App.css        # Styles
│   └── package.json
└── README.md
```

## 🚀 Quick Start

### Prerequisites

- Node.js 18+ and npm
- Anthropic API key ([get one here](https://console.anthropic.com/))
- Firebase project
  - **Quick setup**: `npm run setup:firebase` ([guide](./SETUP_SCRIPT.md))
  - **Manual setup**: Follow [this guide](./FIREBASE_SETUP.md)

### 1. Backend Setup

```bash
cd backend
npm install

# Create .env file
cp .env.example .env

# Edit .env and add your API key:
# ANTHROPIC_API_KEY=your_api_key_here

# Start the server
npm run dev
```

The backend will run on `http://localhost:3001`

### 2. Frontend Setup

Open a new terminal:

```bash
cd frontend
npm install

# Create .env file for Firebase (see FIREBASE_SETUP.md)
# VITE_FIREBASE_API_KEY=your-key
# VITE_FIREBASE_AUTH_DOMAIN=your-domain
# etc...

npm run dev
```

The frontend will run on `http://localhost:5173`

**Important:** Follow the [Firebase Setup Guide](./FIREBASE_SETUP.md) to configure authentication.

### 3. Use the App

1. Open `http://localhost:5173` in your browser
2. Sign up with email/password or Google OAuth
3. Select an interview type (e.g., "Google APM")
4. Upload a transcript file (.txt)
5. Click "Analyze Interview"
6. Watch the real-time analysis!

## 📊 How It Works

The Claude Agent SDK performs an autonomous, multi-step analysis:

1. **Research**: Web searches for current interview evaluation criteria
2. **Parse**: Identifies questions and responses in the transcript
3. **Evaluate**: Scores each question with detailed feedback
4. **Synthesize**: Provides overall assessment and recommendations
5. **Self-Review**: Verifies the analysis for completeness and accuracy

## 💰 Cost Estimates

Approximate API costs per analysis:
- **Small transcript** (10 min): ~$0.10-0.20
- **Medium transcript** (30 min): ~$0.30-0.50
- **Large transcript** (60 min): ~$0.50-0.80

The Agent SDK makes multiple API calls for comprehensive analysis.

## 🧪 Testing

Test the analyzer directly with a transcript:

```bash
cd backend
npm test
```

This runs the analyzer on `../../transcript` and prints results to console.

## 📝 Example Output

The analysis includes:

- **Overall Score**: X/10 with pass/fail assessment
- **Question Breakdown**: Detailed evaluation of each question
- **Timestamps**: Specific moments highlighting strengths and weaknesses
- **Communication Analysis**: Talk-to-listen ratio, pacing, check-ins
- **Comparison**: How performance compares to actual company standards
- **Recommendations**: 5-7 actionable steps for improvement

## 🛠️ Technology Stack

**Backend:**
- Express - Web server
- Claude Agent SDK - AI agent framework
- TypeScript - Type-safe development
- Multer - File uploads

**Frontend:**
- React - UI framework
- TypeScript - Type safety
- Vite - Fast build tool
- Firebase Authentication - User login/signup
- react-markdown - Render analysis
- Server-Sent Events - Real-time streaming

## 🌐 Deployment

### Backend (Railway/Heroku/etc)

```bash
cd backend
npm run build
npm start
```

Set environment variable: `ANTHROPIC_API_KEY`

### Frontend (Vercel/Netlify/etc)

```bash
cd frontend
npm run build
```

Set environment variable: `VITE_API_URL` (your backend URL)

## 📄 API Endpoints

- `GET /health` - Health check
- `GET /api/interview-types` - List supported types
- `POST /api/analyze` - Analyze interview (non-streaming)
- `POST /api/analyze/stream` - Analyze interview (streaming, recommended)

## 🤝 Contributing

This is a prototype built to demonstrate the Claude Agent SDK. Feel free to:
- Add more interview types
- Improve the evaluation prompts
- Add PDF/DOCX support
- Build comparison features
- Add user accounts and history

## 📜 License

MIT

## 🙏 Acknowledgments

- Built with [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk-typescript)
- Inspired by the need for better interview preparation tools
- Thanks to Anthropic for making AI agents accessible

---

**Note**: This tool is for learning and practice. Real interview performance depends on many factors beyond transcript analysis.
