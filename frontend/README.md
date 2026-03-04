# Interview Analyzer - Frontend

React frontend for the Interview Analyzer.

## Setup

1. **Install dependencies:**
   ```bash
   npm install
   ```

2. **Configure environment (optional):**
   ```bash
   cp .env.example .env
   ```

   Edit `.env` if you need to change the backend API URL (default: `http://localhost:9002`).

3. **Run in development mode:**
   ```bash
   npm run dev
   ```

   The app will be available at `http://localhost:5173`

4. **Build for production:**
   ```bash
   npm run build
   ```

## Features

- 📤 **File Upload**: Upload transcript files (.txt format)
- 🎯 **Interview Type Selection**: Choose from built-in types or admin-defined custom types
- ⚡ **Real-time Streaming**: See analysis results as they're generated
- 📊 **Beautiful Markdown Rendering**: Results displayed with syntax highlighting
- 📋 **Copy to Clipboard**: Easy sharing of analysis results
- 📱 **Responsive Design**: Works on desktop and mobile

## Usage

1. Select your interview type from the dropdown
2. Upload a transcript file (.txt)
3. Click "Analyze Interview"
4. Watch the real-time analysis appear
5. Copy or save the results

## Technology Stack

- **React** with TypeScript
- **Vite** for fast development
- **react-markdown** for rendering analysis
- **Server-Sent Events (SSE)** for streaming

## API Integration

The frontend communicates with the backend API at `/api/analyze/stream` endpoint, which uses Server-Sent Events to stream analysis results in real-time.
