# Quick Firebase Setup with Script

This guide shows you how to use the automated setup script to configure Firebase for your Interview Analyzer app.

## Prerequisites

1. **Install Firebase CLI** (if not already installed):
   ```bash
   npm install -g firebase-tools
   ```

2. **Login to Firebase**:
   ```bash
   firebase login
   ```
   This will open a browser window to authenticate with your Google account.

## Option 1: Automated Setup (Recommended)

Run the automated setup script:

```bash
cd /home/ssilver/development/apmi/interview-analyzer
npm run setup:firebase
```

The script will:
1. ✅ Check if Firebase CLI is installed and you're logged in
2. ✅ Create a new Firebase project (you choose the project ID)
3. ✅ Register a web app
4. ✅ Generate the `.env` file with your credentials
5. ⚠️ Guide you to enable authentication methods (requires manual step)

### Follow the prompts:
- Enter a unique project ID (e.g., `interview-analyzer-prod`)
- Enter a display name (e.g., `Interview Analyzer`)
- Confirm to proceed

### Manual step required:
The script will pause and ask you to enable authentication in the Firebase Console:
1. Visit the URL shown (Firebase Console)
2. Go to Authentication > Sign-in method
3. Enable **Email/Password** (toggle ON)
4. Enable **Google** (toggle ON, enter support email)
5. Press Enter to continue

## Option 2: Manual Setup

If the script doesn't work or you prefer manual setup, follow the [detailed manual guide](./FIREBASE_SETUP.md).

## After Setup

1. **Restart the frontend dev server**:
   ```bash
   cd frontend
   npm run dev
   ```

2. **Test the authentication**:
   - Open http://localhost:5173 (or the port shown)
   - Try signing up with email/password
   - Try signing in with Google
   - Verify logout works

## Troubleshooting

### "Firebase CLI not found"
```bash
npm install -g firebase-tools
```

### "Not logged into Firebase"
```bash
firebase login
```

### "Project ID already exists"
Try a different project ID. Project IDs must be globally unique across all Firebase projects.

### "Billing account required"
Some Firebase features require a billing account. You can:
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Set up a billing account (free tier available)
3. Link it to your Firebase project

### Script fails to create project
The script uses Firebase CLI which requires proper permissions. If it fails:
1. Try creating the project manually at https://console.firebase.google.com/
2. Use the same project ID you chose
3. Then run the script again - it will skip project creation and configure the existing project

### Can't fetch web app config automatically
The script will prompt you to enter the configuration manually:
1. Go to Firebase Console > Project Settings
2. Scroll to "Your apps" section
3. Click on your web app
4. Copy the config values and paste them when prompted

## What the Script Creates

After successful setup, you'll have:

1. **Firebase Project**: Created in Firebase Console
2. **Web App**: Registered for your project
3. **`.env` file**: Located at `frontend/.env` with all credentials
4. **Authentication**: Email/Password and Google sign-in enabled

## Security Notes

- The `.env` file is automatically added to `.gitignore`
- Never commit Firebase credentials to version control
- Firebase API keys are safe to expose in client-side code
- Security comes from Authentication rules, not hidden API keys

## Next Steps

Once setup is complete:
1. Start analyzing interviews with authentication!
2. Consider setting up Firebase Security Rules for production
3. Enable email verification for new accounts (optional)
4. Set up password reset functionality (optional)

## Help

If you encounter issues:
1. Check the [detailed manual guide](./FIREBASE_SETUP.md)
2. Run `firebase --version` to check CLI installation
3. Run `firebase projects:list` to verify login status
4. Check Firebase Console for project status: https://console.firebase.google.com/
