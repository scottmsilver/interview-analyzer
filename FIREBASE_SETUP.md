# Firebase Authentication Setup Guide

This guide explains how to set up Firebase Authentication for the Interview Analyzer application.

## Prerequisites

- A Google account
- Node.js and npm installed

## Step 1: Create a Firebase Project

1. Go to [Firebase Console](https://console.firebase.google.com/)
2. Click **Add project**
3. Enter a project name (e.g., "Interview Analyzer")
4. Click **Continue**
5. Disable Google Analytics (optional, not needed for this project)
6. Click **Create project**
7. Wait for the project to be created, then click **Continue**

## Step 2: Register Your Web App

1. In the Firebase Console, click the **Web** icon (`</>`) to add a web app
2. Enter an app nickname (e.g., "Interview Analyzer Web")
3. **Do not** check "Set up Firebase Hosting" (we're running locally)
4. Click **Register app**
5. Copy the Firebase configuration object - it will look like this:

```javascript
const firebaseConfig = {
  apiKey: "AIza...",
  authDomain: "your-project.firebaseapp.com",
  projectId: "your-project",
  storageBucket: "your-project.appspot.com",
  messagingSenderId: "123456789",
  appId: "1:123456789:web:abcdef123456"
};
```

6. Click **Continue to console**

## Step 3: Enable Authentication Methods

1. In the Firebase Console, click **Authentication** in the left sidebar
2. Click **Get started**
3. Go to the **Sign-in method** tab

### Enable Email/Password Authentication

1. Click **Email/Password**
2. Toggle **Enable** to ON
3. Click **Save**

### Enable Google Authentication

1. Click **Google**
2. Toggle **Enable** to ON
3. Enter a **Project support email** (your email)
4. Click **Save**

## Step 4: Configure Your Application

1. In the frontend directory, create a `.env` file:

```bash
cd /home/ssilver/development/apmi/interview-analyzer/frontend
touch .env
```

2. Open the `.env` file and add your Firebase configuration:

```env
VITE_FIREBASE_API_KEY=your-api-key-here
VITE_FIREBASE_AUTH_DOMAIN=your-project.firebaseapp.com
VITE_FIREBASE_PROJECT_ID=your-project-id
VITE_FIREBASE_STORAGE_BUCKET=your-project.appspot.com
VITE_FIREBASE_MESSAGING_SENDER_ID=your-sender-id
VITE_FIREBASE_APP_ID=your-app-id
```

Replace the values with your actual Firebase configuration from Step 2.

**Important:** The `.env` file is already in `.gitignore` so your credentials won't be committed to git.

## Step 5: Restart the Frontend Server

After adding the environment variables, restart the frontend development server:

```bash
# Stop the current server (Ctrl+C)
# Then restart it:
npm run dev
```

## Step 6: Test Authentication

1. Navigate to `http://localhost:5173` (or the port shown by Vite)
2. You should see the login page
3. Try creating an account with email/password
4. Try signing in with Google
5. After signing in, you should see the main application interface
6. Test the logout button to ensure it works

## Testing the Full Flow

1. **Sign Up**: Create a new account with email and password
2. **Sign In**: Log out and sign back in with the same credentials
3. **Google Sign In**: Try signing in with Google
4. **Upload Analysis**: Upload a transcript file and run an analysis
5. **Logout**: Use the logout button to sign out
6. **Protected Access**: Verify you're redirected to login when not authenticated

## Troubleshooting

### "Firebase: Error (auth/invalid-api-key)"

- Check that your `.env` file has the correct `VITE_FIREBASE_API_KEY`
- Make sure environment variables start with `VITE_` (required by Vite)
- Restart the dev server after changing `.env`

### "Firebase: Error (auth/unauthorized-domain)"

This happens when testing on localhost with certain configurations:
1. Go to Firebase Console → Authentication → Settings → Authorized domains
2. Add `localhost` to the authorized domains list

### "Firebase: Error (auth/popup-blocked)"

- Your browser is blocking the Google sign-in popup
- Allow popups for localhost in your browser settings
- Try using email/password authentication instead

### Environment Variables Not Loading

- Make sure the `.env` file is in the frontend directory (not backend or root)
- Variable names must start with `VITE_` to be exposed by Vite
- Restart the dev server after creating/modifying `.env`

## Security Notes

1. **Never commit `.env` files**: The `.env` file contains your Firebase credentials and should never be committed to version control. It's already in `.gitignore`.

2. **Firebase Security Rules**: By default, Firebase allows all authenticated users. For production, you should set up proper security rules in the Firebase Console.

3. **API Key Exposure**: Firebase API keys are meant to be public and are safe to expose in client-side code. Firebase security comes from Authentication and Security Rules, not from hiding the API key.

## Production Deployment

When deploying to production:

1. Add your production domain to **Authorized domains** in Firebase Console
2. Set environment variables in your hosting platform (Vercel, Netlify, etc.)
3. Configure proper Firebase Security Rules
4. Consider enabling email verification for new accounts
5. Set up proper error tracking and monitoring

## Additional Resources

- [Firebase Authentication Documentation](https://firebase.google.com/docs/auth)
- [Vite Environment Variables](https://vitejs.dev/guide/env-and-mode.html)
- [Firebase Security Rules](https://firebase.google.com/docs/rules)
