/**
 * Express server for Interview Analyzer API
 */

import express, { Request, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import { analyzeInterview, analyzeInterviewSync, AnalysisOptions } from './analyzer.js';

// Load environment variables
dotenv.config();

const app = express();
const PORT = process.env.PORT || 3001;

// Configure CORS
const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',') || [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:5174',
  'http://localhost:5175',
  'http://localhost:5176'
];

app.use(cors({
  origin: (origin, callback) => {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);

    if (allowedOrigins.indexOf(origin) !== -1 || process.env.NODE_ENV === 'development') {
      callback(null, true);
    } else {
      callback(new Error('Not allowed by CORS'));
    }
  }
}));

app.use(express.json());

// Configure multer for file uploads (store in memory)
const upload = multer({
  storage: multer.memoryStorage(),
  limits: {
    fileSize: 5 * 1024 * 1024, // 5MB limit
  },
  fileFilter: (req, file, cb) => {
    // Accept text files and common transcript formats
    const allowedMimeTypes = [
      'text/plain',
      'application/json',
      'text/markdown',
      'application/octet-stream' // for .txt files sometimes
    ];

    if (allowedMimeTypes.includes(file.mimetype) || file.originalname.endsWith('.txt')) {
      cb(null, true);
    } else {
      cb(new Error('Invalid file type. Only .txt files are supported.'));
    }
  }
});

/**
 * Health check endpoint
 */
app.get('/health', (req: Request, res: Response) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    apiKeyConfigured: !!process.env.ANTHROPIC_API_KEY
  });
});

/**
 * Streaming analysis endpoint (recommended for better UX)
 */
app.post('/api/analyze/stream', upload.single('transcript'), async (req: Request, res: Response) => {
  try {
    // Validate API key
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'Server configuration error: ANTHROPIC_API_KEY not set'
      });
    }

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        error: 'No transcript file uploaded. Please upload a .txt file.'
      });
    }

    // Parse transcript from file buffer
    const transcript = req.file.buffer.toString('utf-8');

    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({
        error: 'Transcript file is empty'
      });
    }

    // Get interview type from form data (default to google-apm)
    const interviewType = (req.body.interviewType as AnalysisOptions['interviewType']) || 'google-apm';

    // Set up Server-Sent Events (SSE) for streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('X-Accel-Buffering', 'no'); // Disable nginx buffering

    // Disable compression for this response to prevent buffering
    res.socket?.setNoDelay(true);
    res.socket?.setTimeout(0);

    // Send initial message
    res.write(`data: ${JSON.stringify({
      type: 'start',
      message: 'Starting analysis...',
      timestamp: new Date().toISOString()
    })}\n\n`);
    res.flushHeaders(); // Force headers to be sent immediately

    // Run analysis
    const generator = await analyzeInterview(transcript, { interviewType });

    for await (const message of generator) {
      const data = JSON.stringify({
        type: message.type,
        content: message.content,
        raw: (message as any).raw,
        timestamp: message.timestamp.toISOString()
      });

      res.write(`data: ${data}\n\n`);

      // Force immediate flush to client (no buffering)
      if (typeof (res as any).flush === 'function') {
        (res as any).flush();
      }

      // Also log to console for debugging
      console.log(`[Streaming to client] ${message.type}: ${message.content?.substring(0, 50)}...`);
    }

    // Send completion message
    res.write(`data: ${JSON.stringify({
      type: 'complete',
      message: 'Analysis complete',
      timestamp: new Date().toISOString()
    })}\n\n`);

    res.end();

  } catch (error) {
    console.error('Analysis error:', error);

    // Try to send error through SSE if headers not sent
    if (!res.headersSent) {
      res.status(500).json({
        error: 'Analysis failed',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    } else {
      res.write(`data: ${JSON.stringify({
        type: 'error',
        message: error instanceof Error ? error.message : 'Unknown error',
        timestamp: new Date().toISOString()
      })}\n\n`);
      res.end();
    }
  }
});

/**
 * Non-streaming analysis endpoint (simpler, but waits for full result)
 */
app.post('/api/analyze', upload.single('transcript'), async (req: Request, res: Response) => {
  try {
    // Validate API key
    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(500).json({
        error: 'Server configuration error: ANTHROPIC_API_KEY not set'
      });
    }

    // Validate file upload
    if (!req.file) {
      return res.status(400).json({
        error: 'No transcript file uploaded. Please upload a .txt file.'
      });
    }

    // Parse transcript
    const transcript = req.file.buffer.toString('utf-8');

    if (!transcript || transcript.trim().length === 0) {
      return res.status(400).json({
        error: 'Transcript file is empty'
      });
    }

    // Get interview type
    const interviewType = (req.body.interviewType as AnalysisOptions['interviewType']) || 'google-apm';

    // Run analysis
    const analysis = await analyzeInterviewSync(transcript, { interviewType });

    res.json({
      success: true,
      analysis,
      metadata: {
        interviewType,
        transcriptLength: transcript.length,
        analyzedAt: new Date().toISOString()
      }
    });

  } catch (error) {
    console.error('Analysis error:', error);
    res.status(500).json({
      error: 'Analysis failed',
      details: error instanceof Error ? error.message : 'Unknown error'
    });
  }
});

/**
 * Get supported interview types
 */
app.get('/api/interview-types', (req: Request, res: Response) => {
  res.json({
    types: [
      {
        id: 'google-apm',
        name: 'Google APM',
        description: 'Associate Product Manager interview at Google'
      },
      {
        id: 'meta-pm',
        name: 'Meta PM',
        description: 'Product Manager interview at Meta/Facebook'
      },
      {
        id: 'amazon-pm',
        name: 'Amazon PM',
        description: 'Product Manager interview at Amazon'
      },
      {
        id: 'generic',
        name: 'Generic PM',
        description: 'General Product Manager interview'
      }
    ]
  });
});

// Error handling middleware
app.use((err: Error, req: Request, res: Response, next: any) => {
  console.error('Server error:', err);
  res.status(500).json({
    error: 'Internal server error',
    details: process.env.NODE_ENV === 'development' ? err.message : undefined
  });
});

// Start server
app.listen(PORT, () => {
  console.log(`\n🚀 Interview Analyzer API Server`);
  console.log(`📡 Listening on port ${PORT}`);
  console.log(`🔑 API Key configured: ${!!process.env.ANTHROPIC_API_KEY}`);
  console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
  console.log(`\n📚 Endpoints:`);
  console.log(`   GET  /health                - Health check`);
  console.log(`   GET  /api/interview-types   - List supported interview types`);
  console.log(`   POST /api/analyze/stream    - Analyze interview (streaming)`);
  console.log(`   POST /api/analyze           - Analyze interview (non-streaming)`);
  console.log(`\n✨ Ready to analyze interviews!\n`);
});
