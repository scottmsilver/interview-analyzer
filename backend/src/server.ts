/**
 * Express server for Interview Analyzer API
 */

import * as crypto from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { pathToFileURL } from 'url';
import express, { NextFunction, Request, RequestHandler, Response } from 'express';
import cors from 'cors';
import multer from 'multer';
import dotenv from 'dotenv';
import {
  analyzeInterview,
  analyzeInterviewDirectAPI,
  analyzeInterviewSync,
  AnalysisMethod,
  AnalysisOptions,
  getAnthropicModel,
  hasLlmCredentials
} from './analyzer.js';
import {
  AuthenticatedUser,
  optionalVerifiedUser as defaultOptionalVerifiedUser,
  requireApprovedUser as defaultRequireApprovedUser
} from './auth.js';
import {
  getAllCachedCriteria,
  isValidInterviewType,
  refreshCriteriaCache
} from './criteria-cache.js';
import {
  getDb as defaultGetDb,
  isFirebaseConfigured as defaultIsFirebaseConfigured
} from './firebase-admin.js';

// Load environment variables
dotenv.config();

const MAX_CACHED_CRITERIA_BYTES = 50 * 1024;
const SHARE_ID_REGEX = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Extract client IP address, honoring reverse-proxy headers (Cloudflare / X-Forwarded-For).
 */
export function getClientIp(req: Pick<Request, 'headers' | 'ip' | 'socket'>): string {
  const cfConnectingIp = req.headers['cf-connecting-ip'];
  if (typeof cfConnectingIp === 'string' && cfConnectingIp.trim()) {
    return cfConnectingIp.trim();
  }
  if (Array.isArray(cfConnectingIp) && cfConnectingIp[0]?.trim()) {
    return cfConnectingIp[0].trim();
  }

  const forwardedFor = req.headers['x-forwarded-for'];
  const forwardedStr = Array.isArray(forwardedFor) ? forwardedFor[0] : forwardedFor;
  if (typeof forwardedStr === 'string' && forwardedStr.trim()) {
    const firstHop = forwardedStr.split(',')[0]?.trim();
    if (firstHop) return firstHop;
  }

  return req.ip || req.socket?.remoteAddress || 'unknown';
}

/**
 * In-memory sliding-window rate limiter middleware.
 */
export class SlidingWindowRateLimiter {
  private readonly hits = new Map<string, number[]>();

  constructor(
    private readonly windowMs: number,
    private readonly maxRequests: number,
    private readonly keyFn: (req: Request) => string
  ) {}

  middleware: RequestHandler = (req: Request, res: Response, next: NextFunction): void => {
    const now = Date.now();
    const cutoff = now - this.windowMs;
    const key = this.keyFn(req);

    const existing = this.hits.get(key) ?? [];
    const recent = existing.filter((ts) => ts > cutoff);

    if (recent.length >= this.maxRequests) {
      const oldestInWindow = recent[0];
      const retryAfterSec = Math.max(1, Math.ceil((oldestInWindow + this.windowMs - now) / 1000));
      this.hits.set(key, recent);
      res.setHeader('Retry-After', String(retryAfterSec));
      res.status(429).json({
        error: 'Too many requests. Please try again later.'
      });
      return;
    }

    recent.push(now);
    this.hits.set(key, recent);

    if (this.hits.size > 1000) {
      for (const [entryKey, timestamps] of this.hits.entries()) {
        if (timestamps.every((ts) => ts <= cutoff)) {
          this.hits.delete(entryKey);
        }
      }
    }

    next();
  };
}

/**
 * Constant-time comparison for admin API key headers using SHA-256 digests.
 */
export function isValidAdminKey(provided: unknown, expected: string | undefined): boolean {
  if (!expected || typeof provided !== 'string' || provided.length === 0) {
    return false;
  }

  const providedDigest = crypto.createHash('sha256').update(provided, 'utf8').digest();
  const expectedDigest = crypto.createHash('sha256').update(expected, 'utf8').digest();
  return crypto.timingSafeEqual(providedDigest, expectedDigest);
}

/**
 * Security headers applied to all HTTP responses.
 * Cross-Origin-Opener-Policy must remain `same-origin-allow-popups` for Firebase Auth popups.
 */
export function securityHeadersMiddleware(_req: Request, res: Response, next: NextFunction): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
  res.setHeader('Cross-Origin-Opener-Policy', 'same-origin-allow-popups');
  next();
}

function serializeTimestamp(value: any): string | null {
  if (!value) return null;
  if (typeof value?.toDate === 'function') {
    return value.toDate().toISOString();
  }
  if (value instanceof Date) {
    return value.toISOString();
  }
  if (typeof value === 'string') {
    return value;
  }
  return null;
}

function buildSharedAnalysisPayload(
  data: Record<string, any>,
  shareMode: 'anyone' | 'specific'
) {
  return {
    title: data.title ?? null,
    interviewType: data.interviewType ?? null,
    transcriptFileName: data.transcriptFileName ?? null,
    analysis: data.analysis ?? null,
    shareMode,
    createdAt: serializeTimestamp(data.createdAt),
    savedAt: serializeTimestamp(data.savedAt)
  };
}

export interface ServerDeps {
  requireApprovedUser?: RequestHandler;
  optionalVerifiedUser?: (req: Request) => Promise<AuthenticatedUser | null>;
  isFirebaseConfigured?: () => boolean;
  getDb?: () => ReturnType<typeof defaultGetDb>;
  analyzeRateLimiter?: RequestHandler;
  sharedRateLimiter?: RequestHandler;
  staticDir?: string;
}

export function createApp(deps: ServerDeps = {}) {
  const app = express();

  const requireApprovedUser = deps.requireApprovedUser ?? defaultRequireApprovedUser;
  const optionalVerifiedUser = deps.optionalVerifiedUser ?? defaultOptionalVerifiedUser;
  const isFirebaseConfigured = deps.isFirebaseConfigured ?? defaultIsFirebaseConfigured;
  const getDb = deps.getDb ?? defaultGetDb;

  const analyzeRateLimiter =
    deps.analyzeRateLimiter ??
    new SlidingWindowRateLimiter(
      15 * 60 * 1000,
      10,
      (req) => (req.user?.uid ? `uid:${req.user.uid}` : `ip:${getClientIp(req)}`)
    ).middleware;

  const sharedRateLimiter =
    deps.sharedRateLimiter ??
    new SlidingWindowRateLimiter(
      60 * 1000,
      60,
      (req) => `ip:${getClientIp(req)}`
    ).middleware;

  app.use(securityHeadersMiddleware);

  // Configure CORS
  const allowedOrigins = process.env.ALLOWED_ORIGINS?.split(',').map((s) => s.trim()).filter(Boolean) || [
    'http://localhost:3000',
    'http://localhost:5173',
    'http://localhost:5174',
    'http://localhost:5175',
    'http://localhost:5176',
    'https://interview-analyzer-web.fly.dev'
  ];

  app.use(cors({
    origin: (origin, callback) => {
      // Allow requests with no origin (same-origin, mobile apps, or curl requests)
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
    fileFilter: (_req, file, cb) => {
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
  app.get('/health', (_req: Request, res: Response) => {
    res.json({
      status: 'healthy',
      timestamp: new Date().toISOString(),
      apiKeyConfigured: hasLlmCredentials(),
      model: getAnthropicModel()
    });
  });

  /**
   * Streaming analysis endpoint (recommended for better UX)
   */
  app.post(
    '/api/analyze/stream',
    requireApprovedUser,
    analyzeRateLimiter,
    upload.single('transcript'),
    async (req: Request, res: Response) => {
      try {
        if (!hasLlmCredentials()) {
          return res.status(500).json({
            error: 'Server configuration error: LLM credentials not configured'
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

        // Validate interview type before prompt interpolation or search
        const interviewType = (req.body.interviewType as AnalysisOptions['interviewType']) || 'generic';
        if (!isValidInterviewType(interviewType)) {
          return res.status(400).json({
            error: 'Invalid interviewType'
          });
        }

        // Get and bound cached criteria if provided
        const cachedCriteria = req.body.cachedCriteria as unknown;
        if (cachedCriteria !== undefined) {
          if (typeof cachedCriteria !== 'string') {
            return res.status(400).json({ error: 'cachedCriteria must be a string' });
          }
          if (Buffer.byteLength(cachedCriteria, 'utf8') > MAX_CACHED_CRITERIA_BYTES) {
            return res.status(400).json({
              error: 'cachedCriteria exceeds maximum allowed size (50KB)'
            });
          }
        }

        // Get analysis method (default to direct-api for speed)
        const method = (req.body.method as AnalysisMethod) || 'direct-api';
        const methodLabel = method === 'agent-sdk' ? 'Agent SDK (thorough)' : 'Direct API (fast)';

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
          message: `Starting analysis using ${methodLabel}...`,
          method,
          timestamp: new Date().toISOString()
        })}\n\n`);
        res.flushHeaders(); // Force headers to be sent immediately

        // Get optional model override
        const model = (req.body.model as string) || undefined;

        // Send keepalive heartbeats every 15 seconds so connection never idles out on proxies/browsers
        const keepAlive = setInterval(() => {
          if (!res.writableEnded) {
            res.write(': keepalive\n\n');
            if (typeof (res as any).flush === 'function') {
              (res as any).flush();
            }
          }
        }, 15000);

        res.on('close', () => {
          clearInterval(keepAlive);
        });

        try {
          // Run analysis with selected method
          const generator = method === 'agent-sdk'
            ? await analyzeInterview(transcript, { interviewType, cachedCriteria, model })
            : await analyzeInterviewDirectAPI(transcript, { interviewType, cachedCriteria, model });

          for await (const message of generator) {
            if (res.destroyed || res.writableEnded) break;

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

            // Log event type and byte length only (never transcript or model prose)
            const contentBytes = Buffer.byteLength(message.content || '', 'utf8');
            console.log(`[Streaming to client] type=${message.type} bytes=${contentBytes}`);
          }

          // Send completion message if client is still connected
          if (!res.destroyed && !res.writableEnded) {
            res.write(`data: ${JSON.stringify({
              type: 'complete',
              message: 'Analysis complete',
              timestamp: new Date().toISOString()
            })}\n\n`);
            res.end();
          }
        } finally {
          clearInterval(keepAlive);
        }
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
    }
  );

  /**
   * Non-streaming analysis endpoint (simpler, but waits for full result)
   */
  app.post(
    '/api/analyze',
    requireApprovedUser,
    analyzeRateLimiter,
    upload.single('transcript'),
    async (req: Request, res: Response) => {
      try {
        if (!hasLlmCredentials()) {
          return res.status(500).json({
            error: 'Server configuration error: LLM credentials not configured'
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

        // Validate interview type
        const interviewType = (req.body.interviewType as AnalysisOptions['interviewType']) || 'generic';
        if (!isValidInterviewType(interviewType)) {
          return res.status(400).json({
            error: 'Invalid interviewType'
          });
        }

        // Get and bound cached criteria if provided
        const cachedCriteria = req.body.cachedCriteria as unknown;
        if (cachedCriteria !== undefined) {
          if (typeof cachedCriteria !== 'string') {
            return res.status(400).json({ error: 'cachedCriteria must be a string' });
          }
          if (Buffer.byteLength(cachedCriteria, 'utf8') > MAX_CACHED_CRITERIA_BYTES) {
            return res.status(400).json({
              error: 'cachedCriteria exceeds maximum allowed size (50KB)'
            });
          }
        }

        const model = (req.body.model as string) || undefined;

        // Run analysis with optional cached criteria
        const analysis = await analyzeInterviewSync(transcript, { interviewType, cachedCriteria, model });

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
    }
  );

  /**
   * Shared analysis lookup endpoint (replaces direct client Firestore queries).
   * Never returns transcriptContent, userId, or sharedWith.
   */
  app.get('/api/shared/:shareId', sharedRateLimiter, async (req: Request, res: Response) => {
    const shareId = req.params.shareId;
    if (!shareId || !SHARE_ID_REGEX.test(shareId)) {
      return res.status(400).json({
        error: 'Invalid share ID',
        code: 'INVALID_SHARE_ID'
      });
    }

    if (!isFirebaseConfigured()) {
      return res.status(503).json({
        error: 'Sharing service unavailable',
        code: 'SERVICE_UNAVAILABLE'
      });
    }

    try {
      const snapshot = await getDb()
        .collection('analyses')
        .where('shareId', '==', shareId)
        .limit(1)
        .get();

      if (snapshot.empty) {
        return res.status(404).json({
          error: 'Shared analysis not found',
          code: 'NOT_FOUND'
        });
      }

      const data = snapshot.docs[0].data() as Record<string, any>;

      if (!data.shareMode || data.shareMode === 'private') {
        return res.status(403).json({
          error: 'This analysis is not shared',
          code: 'PRIVATE'
        });
      }

      if (data.shareMode === 'anyone') {
        return res.status(200).json(buildSharedAnalysisPayload(data, 'anyone'));
      }

      if (data.shareMode === 'specific') {
        const verifiedUser = await optionalVerifiedUser(req);
        if (!verifiedUser) {
          return res.status(401).json({
            error: 'Please sign in to view this shared analysis',
            code: 'AUTH_REQUIRED'
          });
        }

        const isOwner = Boolean(data.userId) && verifiedUser.uid === data.userId;
        const normalizedUserEmail = verifiedUser.email?.trim().toLowerCase();
        const sharedWithList: unknown[] = Array.isArray(data.sharedWith) ? data.sharedWith : [];
        const isRecipient =
          Boolean(normalizedUserEmail) &&
          sharedWithList.some(
            (entry) => typeof entry === 'string' && entry.trim().toLowerCase() === normalizedUserEmail
          );

        if (!isOwner && !isRecipient) {
          return res.status(403).json({
            error: 'You do not have permission to view this analysis',
            code: 'FORBIDDEN'
          });
        }

        return res.status(200).json(buildSharedAnalysisPayload(data, 'specific'));
      }

      return res.status(403).json({
        error: 'This analysis is not shared',
        code: 'PRIVATE'
      });
    } catch (error) {
      console.error('[Shared] Error loading shared analysis:', error);
      return res.status(500).json({
        error: 'Failed to load shared analysis'
      });
    }
  });

  /**
   * Get supported interview types
   */
  app.get('/api/interview-types', (_req: Request, res: Response) => {
    // Default fallback types — the frontend primarily loads types from Firestore
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
          name: 'General Interview',
          description: 'General interview evaluation'
        }
      ]
    });
  });

  /**
   * Admin: Refresh criteria cache for an interview type
   * Requires ADMIN_API_KEY header for authentication
   */
  app.post('/api/admin/refresh-criteria', async (req: Request, res: Response) => {
    if (!isValidAdminKey(req.headers['x-admin-key'], process.env.ADMIN_API_KEY)) {
      return res.status(401).json({ error: 'Unauthorized - invalid admin key' });
    }

    if (!isFirebaseConfigured()) {
      return res.status(500).json({
        error: 'Firebase not configured - cannot save to cache'
      });
    }

    const { interviewType } = req.body;

    if (!isValidInterviewType(interviewType)) {
      return res.status(400).json({
        error: 'Valid interviewType is required (1-80 characters matching [a-zA-Z0-9 _-])'
      });
    }

    try {
      console.log(`[Admin] Refreshing criteria cache for ${interviewType}...`);
      const criteria = await refreshCriteriaCache(interviewType);

      res.json({
        success: true,
        interviewType,
        criteriaLength: criteria.length,
        message: `Cache refreshed for ${interviewType}`
      });
    } catch (error) {
      console.error('[Admin] Error refreshing criteria:', error);
      res.status(500).json({
        error: 'Failed to refresh criteria cache',
        details: error instanceof Error ? error.message : 'Unknown error'
      });
    }
  });

  /**
   * Admin: Get all cached criteria
   */
  app.get('/api/admin/criteria-cache', async (req: Request, res: Response) => {
    if (!isValidAdminKey(req.headers['x-admin-key'], process.env.ADMIN_API_KEY)) {
      return res.status(401).json({ error: 'Unauthorized - invalid admin key' });
    }

    try {
      const cached = await getAllCachedCriteria();
      res.json({
        configured: isFirebaseConfigured(),
        cache: cached.map(c => ({
          interviewType: c.interviewType,
          lastUpdated: c.lastUpdated?.toDate?.() || c.lastUpdated,
          source: c.source,
          criteriaLength: c.criteria?.length || 0
        }))
      });
    } catch (error) {
      console.error('[Admin] Error getting cache:', error);
      res.status(500).json({ error: 'Failed to get cache' });
    }
  });

  // Optional static frontend serving & SPA fallback
  const staticDirEnv = deps.staticDir ?? process.env.STATIC_DIR;
  if (staticDirEnv) {
    const resolvedStaticDir = path.resolve(staticDirEnv);
    app.use(
      express.static(resolvedStaticDir, {
        setHeaders: (res, filePath) => {
          const relPath = path.relative(resolvedStaticDir, filePath).replace(/\\/g, '/');
          if (relPath.startsWith('assets/')) {
            res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
          } else if (relPath === 'index.html') {
            res.setHeader('Cache-Control', 'no-cache');
          }
        }
      })
    );

    app.get('*', (req: Request, res: Response, next: NextFunction) => {
      if (req.path === '/health' || req.path === '/api' || req.path.startsWith('/api/')) {
        return next();
      }
      if (req.path.startsWith('/assets/')) {
        return res.status(404).end();
      }
      res.setHeader('Cache-Control', 'no-cache');
      res.sendFile(path.join(resolvedStaticDir, 'index.html'));
    });
  }

  // Error handling middleware
  app.use((err: Error, _req: Request, res: Response, _next: NextFunction) => {
    console.error('Server error:', err);
    res.status(500).json({
      error: 'Internal server error',
      details: process.env.NODE_ENV === 'development' ? err.message : undefined
    });
  });

  return app;
}

function isDirectEntrypoint(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return import.meta.url === pathToFileURL(fs.realpathSync(entry)).href;
  } catch {
    return false;
  }
}

if (isDirectEntrypoint()) {
  const PORT = Number(process.env.PORT) || 9002;
  const HOST = process.env.HOST || '0.0.0.0';
  const app = createApp();

  app.listen(PORT, HOST, () => {
    console.log(`\n🚀 Interview Analyzer API Server`);
    console.log(`📡 Listening on ${HOST}:${PORT}`);
    console.log(`🔑 LLM credentials configured: ${hasLlmCredentials()}`);
    console.log(`🤖 Claude Model: ${getAnthropicModel()}`);
    console.log(`🔥 Firebase configured: ${defaultIsFirebaseConfigured()}`);
    console.log(`🔐 Admin API configured: ${!!process.env.ADMIN_API_KEY}`);
    if (process.env.STATIC_DIR) {
      console.log(`📦 Serving static frontend from: ${path.resolve(process.env.STATIC_DIR)}`);
    }
    console.log(`🌍 Environment: ${process.env.NODE_ENV || 'development'}`);
    console.log(`\n📚 Endpoints:`);
    console.log(`   GET  /health                     - Health check`);
    console.log(`   GET  /api/interview-types        - List supported interview types`);
    console.log(`   GET  /api/shared/:shareId        - Fetch shared analysis`);
    console.log(`   POST /api/analyze/stream         - Analyze interview (streaming)`);
    console.log(`   POST /api/analyze                - Analyze interview (non-streaming)`);
    console.log(`   POST /api/admin/refresh-criteria - Refresh criteria cache (admin)`);
    console.log(`   GET  /api/admin/criteria-cache   - View cached criteria (admin)`);
    console.log(`\n✨ Ready to analyze interviews!\n`);
  });
}
