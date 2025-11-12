# 🚀 Setup Guide - PM Interview Analyzer

Complete guide to get your interview analyzer up and running.

## 📋 Prerequisites

Before you begin, make sure you have:

- ✅ **Node.js 18+** installed (`node --version` to check)
- ✅ **npm** installed (comes with Node.js)
- ✅ **Anthropic API key** ([get one here](https://console.anthropic.com/))

## 🎯 Step-by-Step Setup

### Step 1: Get Your Anthropic API Key

1. Go to https://console.anthropic.com/
2. Sign up or log in
3. Navigate to API Keys section
4. Click "Create Key"
5. Copy the key (starts with `sk-ant-...`)

### Step 2: Configure the Backend

```bash
cd /home/ssilver/development/apmi/interview-analyzer/backend

# Create .env file from example
cp .env.example .env

# Edit .env and add your API key
# Use your favorite editor (nano, vim, code, etc.)
nano .env
```

Your `.env` file should look like:
```
ANTHROPIC_API_KEY=sk-ant-api03-your-actual-key-here
PORT=3001
NODE_ENV=development
```

### Step 3: Install Dependencies

The dependencies are already installed, but if you need to reinstall:

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### Step 4: Test the Backend Directly

Before running the full app, test the analyzer directly:

```bash
cd backend
npm test
```

This will analyze the transcript at `../../transcript` and print results to console.

**Expected output**: You should see a detailed analysis streaming to your terminal.

### Step 5: Start Both Services

**Option A: Using the start script (easy)**

```bash
cd /home/ssilver/development/apmi/interview-analyzer
./start.sh
```

**Option B: Manual start (two terminals)**

Terminal 1 (Backend):
```bash
cd backend
npm run dev
```

Terminal 2 (Frontend):
```bash
cd frontend
npm run dev
```

### Step 6: Open the App

Open your browser and go to: **http://localhost:5173**

You should see the PM Interview Analyzer interface!

## 🧪 Testing the Full System

1. **Open the app**: http://localhost:5173
2. **Select interview type**: Choose "Google APM"
3. **Upload transcript**: Click the file upload area and select `/home/ssilver/development/apmi/transcript`
4. **Analyze**: Click the "Analyze Interview" button
5. **Watch magic happen**: You'll see real-time analysis streaming in!

## 🐛 Troubleshooting

### Backend won't start

**Error**: `ANTHROPIC_API_KEY not set`
- **Fix**: Check that your `.env` file exists in `backend/` and has the correct API key

**Error**: `Module not found`
- **Fix**: Run `npm install` in the backend directory

**Error**: `Port 3001 already in use`
- **Fix**: Kill the existing process: `lsof -ti:3001 | xargs kill -9`

### Frontend won't start

**Error**: `Module not found`
- **Fix**: Run `npm install` in the frontend directory

**Error**: `Port 5173 already in use`
- **Fix**: Kill the existing process: `lsof -ti:5173 | xargs kill -9`

### Analysis fails

**Error**: `HTTP error! status: 500`
- **Fix**: Check backend logs for errors. Usually an API key issue.

**Error**: `No transcript file uploaded`
- **Fix**: Make sure you're selecting a `.txt` file

### Frontend can't connect to backend

**Symptom**: Network errors in console
- **Fix**: Make sure backend is running on port 3001
- Check: `curl http://localhost:3001/health`

## 📊 What to Expect

A typical analysis takes **1-3 minutes** depending on transcript length.

The Claude Agent will:
1. **Research** current interview criteria (web search)
2. **Parse** your transcript and identify questions
3. **Evaluate** each question with detailed feedback
4. **Generate** overall scores and recommendations
5. **Self-review** the analysis for completeness

You'll see progress messages like:
- "Researching evaluation criteria..."
- "Analyzing transcript..."
- "Evaluating responses..."
- "Generating recommendations..."
- "Finalizing analysis..."

## 💡 Tips for Best Results

1. **Transcript format**: Plain text (.txt) works best
2. **Include timestamps**: The analyzer uses timestamps for specific feedback
3. **Complete transcripts**: More content = better analysis
4. **Multiple runs**: Try analyzing the same interview multiple times to see consistency

## 📝 Example Transcript Format

Your transcript should look something like:
```
00:00:15
Interviewer: Design a feature to help users reduce screen time.

00:00:45
Candidate: Great question. I'd like to start by clarifying a few things...
```

The existing transcript at `../../transcript` is a perfect example!

## 🎉 Success Indicators

You'll know everything is working when:

- ✅ Backend health check returns `{"status": "healthy"}`
- ✅ Frontend loads without errors
- ✅ File upload shows green checkmark
- ✅ Analysis starts and progress bar moves
- ✅ Results appear with markdown formatting
- ✅ You can copy the results

## 🆘 Still Having Issues?

Check the log files:
```bash
# Backend logs
tail -f backend.log

# Or check the terminal where you ran npm run dev
```

Common issues are usually:
1. Missing API key
2. Wrong API key format
3. Network/firewall blocking requests
4. Node version too old (need 18+)

## 🚀 Next Steps

Once everything works:

1. **Try different interview types**: Meta PM, Amazon PM, etc.
2. **Analyze multiple transcripts**: Compare different interview attempts
3. **Customize prompts**: Edit `backend/src/analyzer.ts` to adjust evaluation criteria
4. **Deploy it**: Use Railway/Heroku for backend, Vercel/Netlify for frontend

## 📚 Additional Resources

- [Claude Agent SDK Docs](https://docs.claude.com/en/docs/agent-sdk/overview)
- [Anthropic API Docs](https://docs.anthropic.com/)
- [Project README](README.md)

---

**Need help?** Check the logs, verify your API key, and make sure both services are running!
