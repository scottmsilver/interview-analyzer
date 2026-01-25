const {onDocumentCreated} = require("firebase-functions/v2/firestore");
const {onRequest} = require("firebase-functions/v2/https");
const {onSchedule} = require("firebase-functions/v2/scheduler");
const admin = require("firebase-admin");
const {setGlobalOptions} = require("firebase-functions/v2");
const {google} = require("googleapis");
const {Logging} = require("@google-cloud/logging");

admin.initializeApp();

// Initialize Cloud Logging client
const logging = new Logging();

// Set global options
setGlobalOptions({region: "us-central1"});

// OAuth2 configuration
const OAUTH_CLIENT_ID = process.env.GMAIL_OAUTH_CLIENT_ID;
const OAUTH_CLIENT_SECRET = process.env.GMAIL_OAUTH_CLIENT_SECRET;
const OAUTH_REDIRECT_URI = "https://us-central1-interview-analyzer-prod.cloudfunctions.net/gmailOAuthCallback";

/**
 * Initiates Gmail OAuth flow for admin
 */
exports.authorizeGmail = onRequest(async (req, res) => {
  // Verify user is admin
  const {adminUid} = req.query;

  if (!adminUid) {
    res.status(400).send("Missing adminUid parameter");
    return;
  }

  // Check if user is admin
  const adminDoc = await admin.firestore().collection("admins").doc(adminUid).get();
  if (!adminDoc.exists) {
    res.status(403).send("Not authorized");
    return;
  }

  const oauth2Client = new google.auth.OAuth2(
      OAUTH_CLIENT_ID,
      OAUTH_CLIENT_SECRET,
      OAUTH_REDIRECT_URI,
  );

  const scopes = [
    "https://www.googleapis.com/auth/gmail.send",
  ];

  const authUrl = oauth2Client.generateAuthUrl({
    access_type: "offline",
    prompt: "consent", // Force consent to always get refresh_token
    scope: scopes,
    state: adminUid, // Pass admin UID in state to identify on callback
  });

  res.redirect(authUrl);
});

/**
 * Handles OAuth callback and stores tokens
 */
exports.gmailOAuthCallback = onRequest(async (req, res) => {
  const {code, state} = req.query;

  if (!code || !state) {
    res.status(400).send("Missing code or state parameter");
    return;
  }

  const adminUid = state;

  try {
    const oauth2Client = new google.auth.OAuth2(
        OAUTH_CLIENT_ID,
        OAUTH_CLIENT_SECRET,
        OAUTH_REDIRECT_URI,
    );

    // Exchange code for tokens
    const {tokens} = await oauth2Client.getToken(code);

    // Store tokens in Firestore (encrypted in production!)
    await admin.firestore().collection("admins").doc(adminUid).update({
      gmailTokens: tokens,
      gmailAuthorizedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>Gmail Authorized</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: #fafafa;
          }
          .card {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
            text-align: center;
          }
          h1 { color: #10b981; margin-top: 0; }
          .success-icon { font-size: 48px; margin: 20px 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <div class="success-icon">✅</div>
          <h1>Gmail Authorized!</h1>
          <p>Your Gmail account has been successfully connected.</p>
          <p>You can now close this window and return to the Admin Dashboard.</p>
          <p style="margin-top: 30px; color: #666; font-size: 14px;">
            Approval emails will be sent from your Gmail account when new users sign up.
          </p>
        </div>
        <script>
          // Auto-close after 3 seconds
          setTimeout(() => window.close(), 3000);
        </script>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Error during OAuth callback:", error);
    res.status(500).send(`Error: ${error.message}`);
  }
});

/**
 * Sends an approval email when a new user signs up
 */
exports.sendApprovalEmail = onDocumentCreated("users/{userId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No data associated with the event");
    return;
  }

  const userData = snapshot.data();
  const userId = event.params.userId;

  // Only process new pending users
  if (userData.approved !== false) {
    return;
  }

  // Check if user has a valid invite - if so, auto-approve
  const wasAutoApproved = await checkAndAutoApprove(userId, userData.email);
  if (wasAutoApproved) {
    console.log(`User ${userData.email} was auto-approved via invite, skipping approval email`);
    return;
  }

  const approveUrl = `https://us-central1-interview-analyzer-prod.cloudfunctions.net/approveUser?userId=${userId}&token=${generateToken(userId)}`;

  // Get first admin with Gmail tokens
  const adminsSnapshot = await admin.firestore().collection("admins").get();
  let adminWithGmail = null;

  for (const doc of adminsSnapshot.docs) {
    const adminData = doc.data();
    if (adminData.gmailTokens) {
      adminWithGmail = {id: doc.id, ...adminData};
      break;
    }
  }

  if (!adminWithGmail) {
    console.log("No admin with Gmail authorization found. Logging instead:");
    console.log(`
📧 New User Signup Notification
================================
User Email: ${userData.email}
User ID: ${userId}
Signed up: ${userData.createdAt}

Approve URL: ${approveUrl}
    `);
    return;
  }

  try {
    // Send email via Gmail API
    const oauth2Client = new google.auth.OAuth2(
        OAUTH_CLIENT_ID,
        OAUTH_CLIENT_SECRET,
        OAUTH_REDIRECT_URI,
    );

    oauth2Client.setCredentials(adminWithGmail.gmailTokens);

    const gmail = google.gmail({version: "v1", auth: oauth2Client});

    const emailContent = `From: ${adminWithGmail.email}
To: ${adminWithGmail.email}
Subject: New User Signup: ${userData.email}
Content-Type: text/html; charset=utf-8

<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
  <h2 style="color: #333;">New User Signup</h2>
  <p>A new user has signed up for Interview Analyzer and is pending approval:</p>

  <div style="background: #f5f5f5; padding: 15px; border-radius: 8px; margin: 20px 0;">
    <p style="margin: 5px 0;"><strong>Email:</strong> ${userData.email}</p>
    <p style="margin: 5px 0;"><strong>User ID:</strong> ${userId}</p>
    <p style="margin: 5px 0;"><strong>Signed up:</strong> ${new Date(userData.createdAt).toLocaleString()}</p>
  </div>

  <p style="margin: 30px 0;">
    <a href="${approveUrl}"
       style="background: #10b981; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block;">
      ✓ Approve User
    </a>
  </p>

  <p style="color: #666; font-size: 14px;">
    Or approve manually in the <a href="https://interview-analyzer-prod.web.app">Admin Dashboard</a>.
  </p>
</body>
</html>`;

    const encodedEmail = Buffer.from(emailContent)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedEmail,
      },
    });

    console.log(`✅ Approval email sent to ${adminWithGmail.email} for user ${userData.email}`);
  } catch (error) {
    console.error("Error sending email:", error);
    // Fall back to logging
    console.log(`
📧 New User Signup Notification (email failed)
================================
User Email: ${userData.email}
User ID: ${userId}
Approve URL: ${approveUrl}
    `);
  }

  return null;
});

/**
 * One-click approval endpoint
 */
exports.approveUser = onRequest(async (req, res) => {
  const {userId, token} = req.query;

  if (!userId || !token) {
    res.status(400).send("Missing userId or token");
    return;
  }

  // Verify token
  if (!verifyToken(userId, token)) {
    res.status(403).send("Invalid token");
    return;
  }

  try {
    // Update user approval status
    await admin.firestore().collection("users").doc(userId).update({
      approved: true,
      approvedAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    // Get user data
    const userDoc = await admin.firestore().collection("users").doc(userId).get();
    const userData = userDoc.data();

    res.send(`
      <!DOCTYPE html>
      <html>
      <head>
        <title>User Approved</title>
        <style>
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            max-width: 600px;
            margin: 50px auto;
            padding: 20px;
            background: #fafafa;
          }
          .card {
            background: white;
            border-radius: 8px;
            padding: 30px;
            box-shadow: 0 2px 8px rgba(0,0,0,0.1);
          }
          h1 { color: #10b981; margin-top: 0; }
          .info { background: #f5f5f5; padding: 15px; border-radius: 6px; margin: 20px 0; }
          .info p { margin: 5px 0; }
        </style>
      </head>
      <body>
        <div class="card">
          <h1>✅ User Approved!</h1>
          <p>The user has been successfully approved and can now access the application.</p>
          <div class="info">
            <p><strong>Email:</strong> ${userData?.email || "N/A"}</p>
            <p><strong>User ID:</strong> ${userId}</p>
            <p><strong>Approved:</strong> Just now</p>
          </div>
          <p>The user will automatically gain access - no page refresh needed on their end!</p>
        </div>
      </body>
      </html>
    `);
  } catch (error) {
    console.error("Error approving user:", error);
    res.status(500).send(`Error approving user: ${error.message}`);
  }
});

/**
 * Sends an invite email when a new invite is created
 */
exports.sendInviteEmail = onDocumentCreated("invites/{inviteId}", async (event) => {
  const snapshot = event.data;
  if (!snapshot) {
    console.log("No data associated with the event");
    return;
  }

  const inviteData = snapshot.data();
  const inviteId = event.params.inviteId;

  // Only send email for pending invites
  if (inviteData.status !== "pending") {
    return;
  }

  const baseUrl = inviteData.origin || "https://interview-analyzer-web.fly.dev";
  const signupUrl = `${baseUrl}/?invite=${inviteData.token}`;

  // Get the admin who sent the invite
  const adminDoc = await admin.firestore().collection("admins").doc(inviteData.invitedBy).get();
  const adminData = adminDoc.exists ? adminDoc.data() : null;

  if (!adminData?.gmailTokens) {
    console.log("Admin has no Gmail authorization. Logging instead:");
    console.log(`
📧 Invite Email
================================
Invited: ${inviteData.email}
Invite ID: ${inviteId}
Signup URL: ${signupUrl}
Expires: ${inviteData.expiresAt}
    `);

    // Update invite document with email failure status
    await admin.firestore().collection("invites").doc(inviteId).update({
      emailSent: false,
      emailError: "Gmail not connected - please connect Gmail in Admin settings",
    });

    return;
  }

  try {
    const oauth2Client = new google.auth.OAuth2(
        OAUTH_CLIENT_ID,
        OAUTH_CLIENT_SECRET,
        OAUTH_REDIRECT_URI,
    );

    oauth2Client.setCredentials(adminData.gmailTokens);

    const gmail = google.gmail({version: "v1", auth: oauth2Client});

    const emailContent = `From: ${adminData.email}
To: ${inviteData.email}
Subject: You're invited to Interview Analyzer
Content-Type: text/html; charset=utf-8

<html>
<body style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
  <h2 style="color: #333;">You're Invited!</h2>
  <p>You've been invited to join Interview Analyzer - a tool that provides thoughtful, constructive feedback on your PM interview practice.</p>

  <p style="margin: 30px 0;">
    <a href="${signupUrl}"
       style="background: #6366f1; color: white; padding: 14px 28px; text-decoration: none; border-radius: 8px; display: inline-block; font-weight: 500;">
      Accept Invitation
    </a>
  </p>

  <p style="color: #666; font-size: 14px;">
    This invitation will expire in 7 days.
  </p>

  <p style="color: #666; font-size: 14px;">
    Simply click the button above and sign in with your Google account (${inviteData.email}) to get started.
  </p>
</body>
</html>`;

    const encodedEmail = Buffer.from(emailContent)
        .toString("base64")
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "");

    await gmail.users.messages.send({
      userId: "me",
      requestBody: {
        raw: encodedEmail,
      },
    });

    // Update invite document with email success status
    await admin.firestore().collection("invites").doc(inviteId).update({
      emailSent: true,
      emailSentAt: admin.firestore.FieldValue.serverTimestamp(),
    });

    console.log(`✅ Invite email sent to ${inviteData.email}`);
  } catch (error) {
    console.error("Error sending invite email:", error);

    // Update invite document with email failure status
    await admin.firestore().collection("invites").doc(inviteId).update({
      emailSent: false,
      emailError: error.message || "Unknown error",
    });

    console.log(`
📧 Invite Email (email failed)
================================
Invited: ${inviteData.email}
Signup URL: ${signupUrl}
Error: ${error.message}
    `);
  }

  return null;
});

/**
 * Scheduled function to refresh Gmail tokens weekly
 * Keeps tokens active to prevent expiration
 */
exports.refreshGmailTokens = onSchedule("every monday 09:00", async () => {
  console.log("Starting scheduled Gmail token refresh...");

  const adminsSnapshot = await admin.firestore().collection("admins").get();

  for (const doc of adminsSnapshot.docs) {
    const adminData = doc.data();
    if (!adminData.gmailTokens) continue;

    try {
      const oauth2Client = new google.auth.OAuth2(
          OAUTH_CLIENT_ID,
          OAUTH_CLIENT_SECRET,
          OAUTH_REDIRECT_URI,
      );

      oauth2Client.setCredentials(adminData.gmailTokens);

      // Force a token refresh
      const {credentials} = await oauth2Client.refreshAccessToken();

      // Update stored tokens with new ones
      await doc.ref.update({
        gmailTokens: credentials,
        gmailTokenRefreshedAt: admin.firestore.FieldValue.serverTimestamp(),
      });

      console.log(`✅ Refreshed Gmail token for admin ${doc.id}`);
    } catch (error) {
      console.error(`❌ Failed to refresh token for admin ${doc.id}:`, error.message);

      // Mark token as potentially invalid
      await doc.ref.update({
        gmailTokenError: error.message,
        gmailTokenErrorAt: admin.firestore.FieldValue.serverTimestamp(),
      });
    }
  }

  console.log("Gmail token refresh complete.");
  return null;
});

/**
 * Generate a simple token for approval link
 */
function generateToken(userId) {
  const secret = process.env.APPROVAL_SECRET || "interview-analyzer-secret";
  const crypto = require("crypto");
  return crypto.createHmac("sha256", secret).update(userId).digest("hex").substring(0, 16);
}

/**
 * Verify the approval token
 */
function verifyToken(userId, token) {
  return token === generateToken(userId);
}

/**
 * Check if user email has a pending valid invite and auto-approve if so
 */
async function checkAndAutoApprove(userId, userEmail) {
  if (!userEmail) return false;

  const normalizedEmail = userEmail.toLowerCase();
  const now = new Date();

  // Find matching pending invite
  const invitesSnapshot = await admin.firestore()
      .collection("invites")
      .where("email", "==", normalizedEmail)
      .where("status", "==", "pending")
      .get();

  for (const inviteDoc of invitesSnapshot.docs) {
    const inviteData = inviteDoc.data();
    const expiresAt = new Date(inviteData.expiresAt);

    if (expiresAt > now) {
      // Valid invite found - auto-approve user
      await admin.firestore().collection("users").doc(userId).update({
        approved: true,
        approvedAt: admin.firestore.FieldValue.serverTimestamp(),
        approvedViaInvite: inviteDoc.id,
      });

      // Mark invite as accepted
      await inviteDoc.ref.update({
        status: "accepted",
        acceptedAt: admin.firestore.FieldValue.serverTimestamp(),
        acceptedByUserId: userId,
      });

      console.log(`✅ Auto-approved user ${userEmail} via invite ${inviteDoc.id}`);
      return true;
    }
  }

  return false;
}

/**
 * Fetches recent logs for admin viewing
 * Requires admin authentication
 */
exports.fetchLogs = onRequest({cors: true}, async (req, res) => {
  try {
    // Verify admin authentication via Firebase ID token
    const authHeader = req.headers.authorization;
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
      res.status(401).json({error: "Unauthorized: Missing token"});
      return;
    }

    const idToken = authHeader.split("Bearer ")[1];
    const decodedToken = await admin.auth().verifyIdToken(idToken);
    const uid = decodedToken.uid;

    // Check if user is admin
    const adminDoc = await admin.firestore().collection("admins").doc(uid).get();
    if (!adminDoc.exists) {
      // Also check config/admins for email-based admin
      const configDoc = await admin.firestore().collection("config").doc("admins").get();
      const emails = configDoc.exists ? (configDoc.data()?.emails || []) : [];
      if (!emails.includes(decodedToken.email?.toLowerCase())) {
        res.status(403).json({error: "Forbidden: Not an admin"});
        return;
      }
    }

    // Parse query parameters
    const limit = Math.min(parseInt(req.query.limit) || 100, 500);
    const severity = req.query.severity; // DEBUG, INFO, WARNING, ERROR
    const hoursAgo = parseInt(req.query.hoursAgo) || 24;

    // Build log filter - include both Cloud Functions and Cloud Run (Functions v2 uses Cloud Run)
    const startTime = new Date(Date.now() - hoursAgo * 60 * 60 * 1000);

    let filter = `(resource.type="cloud_function" OR resource.type="cloud_run_revision") AND timestamp >= "${startTime.toISOString()}"`;
    if (severity) {
      filter += ` AND severity="${severity.toUpperCase()}"`;
    }

    // Query logs
    const [entries] = await logging.getEntries({
      filter,
      orderBy: "timestamp desc",
      pageSize: limit,
    });

    // Format log entries for frontend
    const logs = entries.map((entry) => {
      const data = entry.data;
      let message = "";

      if (typeof data === "string") {
        message = data;
      } else if (data?.message) {
        message = data.message;
      } else if (data?.textPayload) {
        message = data.textPayload;
      } else if (data) {
        message = JSON.stringify(data);
      }

      // Get function name from either Cloud Function or Cloud Run resource labels
      const functionName = entry.metadata.resource?.labels?.function_name ||
                          entry.metadata.resource?.labels?.service_name ||
                          "unknown";

      return {
        timestamp: entry.metadata.timestamp,
        severity: entry.metadata.severity || "DEFAULT",
        functionName,
        message: message.substring(0, 2000), // Truncate very long messages
        executionId: entry.metadata.labels?.execution_id,
      };
    });

    res.json({
      logs,
      count: logs.length,
      filter: {severity, hoursAgo, limit},
    });
  } catch (error) {
    console.error("Error fetching logs:", error);
    res.status(500).json({error: error.message});
  }
});
