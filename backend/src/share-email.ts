/**
 * Email delivery helper for shared interview analyses via Resend.
 */

export interface SendShareEmailsInput {
  recipients: string[];
  shareUrl: string;
  analysisTitle: string;
  interviewType?: string | null;
  shareMode: 'anyone' | 'specific';
  sharedByEmail?: string | null;
}

export interface SendShareEmailsConfig {
  apiKey?: string;
  fromEmail?: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}

export interface SendShareEmailsResult {
  sent: string[];
  failed: Array<{ email: string; error: string }>;
}

const SIMPLE_EMAIL_REGEX =
  /^[A-Za-z0-9.!#$%&'*+/=?^_`{|}~-]+@[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?(?:\.[A-Za-z0-9](?:[A-Za-z0-9-]{0,61}[A-Za-z0-9])?)+$/;

/**
 * Validate a recipient email address strictly, rejecting whitespace, angle brackets, quotes, and control chars.
 */
export function isValidRecipientEmail(email: string): boolean {
  if (typeof email !== 'string') return false;
  const trimmed = email.trim();
  if (!trimmed || trimmed.length > 254) return false;
  if (/[\r\n\s<>"']/.test(trimmed)) return false;
  return SIMPLE_EMAIL_REGEX.test(trimmed);
}

function validateOriginUrl(candidate: string): string | null {
  try {
    const parsed = new URL(candidate);
    if (
      (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') ||
      parsed.username ||
      parsed.password ||
      parsed.search ||
      parsed.hash ||
      (parsed.pathname !== '/' && parsed.pathname !== '')
    ) {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

/**
 * Resolve the canonical public app origin for share URLs built on the server.
 */
export function resolvePublicAppOrigin(options: {
  configuredUrl?: string;
  requestOrigin?: string;
  requestHost?: string;
  requestProto?: string;
}): string | null {
  const configured = (options.configuredUrl ?? process.env.PUBLIC_APP_URL)?.trim();
  if (configured) {
    const origin = validateOriginUrl(configured);
    if (origin) return origin;
  }

  if (options.requestOrigin) {
    const origin = validateOriginUrl(options.requestOrigin.trim());
    if (origin) return origin;
  }

  if (options.requestHost) {
    const host = options.requestHost.trim();
    if (!host || /[\s/@\\]/.test(host)) {
      return null;
    }
    const proto = options.requestProto === 'http' || options.requestProto === 'https'
      ? options.requestProto
      : 'https';
    return validateOriginUrl(`${proto}://${host}`);
  }

  return null;
}

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function sanitizeHeaderText(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').trim();
}

function scrubSecret(message: string, secret: string): string {
  if (!secret) return message;
  return message.split(secret).join('[REDACTED]');
}

function formatInterviewTypeLabel(interviewType?: string | null): string {
  if (!interviewType) return 'Interview';
  const builtIn: Record<string, string> = {
    'google-apm': 'Google APM',
    'meta-pm': 'Meta PM',
    'amazon-pm': 'Amazon PM',
    generic: 'General Interview',
  };
  return builtIn[interviewType] || interviewType;
}

function buildShareEmailContent(params: {
  recipient: string;
  shareUrl: string;
  analysisTitle: string;
  interviewType?: string | null;
  shareMode: 'anyone' | 'specific';
  sharedByEmail?: string | null;
}): { subject: string; text: string; html: string } {
  const safeRawTitle = sanitizeHeaderText(params.analysisTitle || 'Interview Analysis');
  const displayTitle = safeRawTitle.length > 120 ? `${safeRawTitle.slice(0, 117)}...` : safeRawTitle;
  const senderLabel =
    params.sharedByEmail && isValidRecipientEmail(params.sharedByEmail)
      ? sanitizeHeaderText(params.sharedByEmail)
      : null;
  const typeLabel = sanitizeHeaderText(formatInterviewTypeLabel(params.interviewType));

  const subject = senderLabel
    ? `${senderLabel} shared an interview analysis: ${displayTitle}`
    : `Shared interview analysis: ${displayTitle}`;

  const accessNote =
    params.shareMode === 'specific'
      ? `Sign in with ${params.recipient} to view this analysis.`
      : 'Anyone with this link can view the analysis.';

  const introLine = senderLabel
    ? `${senderLabel} shared an interview analysis with you on Interview Analyzer.`
    : 'An interview analysis was shared with you on Interview Analyzer.';

  const text = [
    introLine,
    '',
    `Title: ${displayTitle}`,
    `Type: ${typeLabel}`,
    '',
    `View Analysis: ${params.shareUrl}`,
    '',
    accessNote,
  ].join('\n');

  const html = [
    '<!doctype html>',
    '<html><body style="margin:0;padding:24px;background:#faf8f6;font-family:-apple-system,BlinkMacSystemFont,\'Segoe UI\',Roboto,sans-serif;color:#1f2937;">',
    '<div style="max-width:560px;margin:0 auto;background:#ffffff;border:1px solid #ece3db;border-radius:12px;padding:28px;">',
    '<p style="margin:0 0 8px;font-size:12px;font-weight:600;letter-spacing:0.04em;text-transform:uppercase;color:#9a5a34;">Interview Analyzer</p>',
    `<h1 style="margin:0 0 12px;font-size:20px;line-height:1.35;color:#111827;">${escapeHtml(displayTitle)}</h1>`,
    `<p style="margin:0 0 18px;font-size:15px;line-height:1.55;color:#374151;">${escapeHtml(introLine)}</p>`,
    `<p style="margin:0 0 22px;font-size:13px;color:#6b7280;">Interview type: <strong style="color:#374151;">${escapeHtml(typeLabel)}</strong></p>`,
    '<p style="margin:0 0 22px;">',
    `<a href="${escapeHtml(params.shareUrl)}" style="display:inline-block;background:#c77a4b;color:#ffffff;text-decoration:none;font-weight:600;font-size:14px;padding:11px 22px;border-radius:8px;">View Analysis</a>`,
    '</p>',
    `<p style="margin:0 0 14px;font-size:13px;line-height:1.5;color:#4b5563;">${escapeHtml(accessNote)}</p>`,
    `<p style="margin:0;font-size:12px;line-height:1.5;color:#6b7280;word-break:break-all;">Or open this link directly:<br><a href="${escapeHtml(params.shareUrl)}" style="color:#9a5a34;">${escapeHtml(params.shareUrl)}</a></p>`,
    '</div>',
    '</body></html>',
  ].join('\n');

  return { subject, text, html };
}

/**
 * Send individual notification emails containing the share link to each recipient via Resend.
 */
export async function sendShareEmails(
  input: SendShareEmailsInput,
  config: SendShareEmailsConfig = {}
): Promise<SendShareEmailsResult> {
  const apiKey = (config.apiKey ?? process.env.RESEND_API_KEY)?.trim() || '';
  const fromEmail = (config.fromEmail ?? process.env.RESEND_FROM_EMAIL)?.trim() || '';
  const baseUrl = (config.baseUrl ?? process.env.RESEND_BASE_URL ?? 'https://api.resend.com')
    .trim()
    .replace(/\/+$/, '');
  const fetchImpl = config.fetchImpl ?? fetch;

  if (!apiKey || !fromEmail) {
    const err = new Error('Email delivery is not configured') as Error & { code?: string };
    err.code = 'EMAIL_NOT_CONFIGURED';
    throw err;
  }

  const parsedShareUrl = new URL(input.shareUrl);
  if (parsedShareUrl.protocol !== 'http:' && parsedShareUrl.protocol !== 'https:') {
    throw new Error('Invalid share URL protocol');
  }

  const replyTo =
    input.sharedByEmail && isValidRecipientEmail(input.sharedByEmail)
      ? input.sharedByEmail.trim().toLowerCase()
      : undefined;

  const uniqueRecipients = Array.from(
    new Set(input.recipients.map((email) => email.trim().toLowerCase()).filter(Boolean))
  );

  const outcomes = await Promise.allSettled(
    uniqueRecipients.map(async (recipient) => {
      if (!isValidRecipientEmail(recipient)) {
        throw new Error(`Invalid recipient email: ${recipient}`);
      }

      const content = buildShareEmailContent({
        recipient,
        shareUrl: parsedShareUrl.toString(),
        analysisTitle: input.analysisTitle,
        interviewType: input.interviewType,
        shareMode: input.shareMode,
        sharedByEmail: replyTo ?? null,
      });

      const payload: Record<string, unknown> = {
        from: fromEmail,
        to: [recipient],
        subject: content.subject,
        text: content.text,
        html: content.html,
      };
      if (replyTo) {
        payload.reply_to = replyTo;
      }

      const response = await fetchImpl(`${baseUrl}/emails`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(10_000),
      });

      if (!response.ok) {
        let errorMessage = `Resend HTTP ${response.status}`;
        try {
          const errJson = (await response.json()) as { message?: unknown; error?: unknown };
          if (typeof errJson?.message === 'string' && errJson.message.trim()) {
            errorMessage = errJson.message.trim();
          } else if (typeof errJson?.error === 'string' && errJson.error.trim()) {
            errorMessage = errJson.error.trim();
          }
        } catch {
          // Ignore non-JSON error responses
        }
        throw new Error(scrubSecret(errorMessage, apiKey));
      }

      return recipient;
    })
  );

  const sent: string[] = [];
  const failed: Array<{ email: string; error: string }> = [];

  outcomes.forEach((outcome, idx) => {
    const email = uniqueRecipients[idx];
    if (outcome.status === 'fulfilled') {
      sent.push(outcome.value);
    } else {
      const rawMsg =
        outcome.reason instanceof Error ? outcome.reason.message : 'Failed to send email';
      failed.push({ email, error: scrubSecret(rawMsg, apiKey) });
    }
  });

  return { sent, failed };
}
