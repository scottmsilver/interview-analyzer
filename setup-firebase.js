#!/usr/bin/env node

/**
 * Firebase Setup Script
 *
 * This script automates the Firebase project setup process:
 * 1. Creates a new Firebase project
 * 2. Enables Email/Password and Google authentication
 * 3. Registers a web app
 * 4. Generates the .env file with credentials
 *
 * Prerequisites:
 * - You must be logged in with Firebase CLI: `firebase login`
 * - You need a Google Cloud Platform billing account (required for new projects)
 */

import { execSync } from 'child_process';
import { writeFileSync, existsSync } from 'fs';
import { join } from 'path';
import readline from 'readline';

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

function question(prompt) {
  return new Promise((resolve) => {
    rl.question(prompt, resolve);
  });
}

function exec(command, options = {}) {
  try {
    return execSync(command, {
      encoding: 'utf8',
      stdio: options.silent ? 'pipe' : 'inherit',
      ...options
    });
  } catch (error) {
    if (options.ignoreError) {
      return null;
    }
    throw error;
  }
}

function checkFirebaseCLI() {
  console.log('🔍 Checking Firebase CLI installation...');
  try {
    const version = exec('firebase --version', { silent: true });
    console.log(`✅ Firebase CLI installed: ${version.trim()}`);
    return true;
  } catch (error) {
    console.error('❌ Firebase CLI not found.');
    console.log('\n📦 Install Firebase CLI:');
    console.log('   npm install -g firebase-tools');
    console.log('   firebase login');
    return false;
  }
}

function checkFirebaseLogin() {
  console.log('\n🔍 Checking Firebase authentication...');
  try {
    const output = exec('firebase projects:list', { silent: true, ignoreError: true });
    if (output && !output.includes('Error')) {
      console.log('✅ Logged into Firebase');
      return true;
    }
  } catch (error) {
    // Fall through to login prompt
  }

  console.log('❌ Not logged into Firebase');
  console.log('\n🔑 Please run: firebase login');
  return false;
}

async function getProjectId() {
  console.log('\n📝 Firebase Project Configuration');
  console.log('   Project ID must be unique across all Firebase projects');
  console.log('   Use lowercase letters, numbers, and hyphens only');
  console.log('   Example: interview-analyzer-prod, my-interview-app-123\n');

  const projectId = await question('Enter project ID: ');
  return projectId.trim().toLowerCase();
}

async function getProjectDisplayName(projectId) {
  const defaultName = projectId.split('-').map(word =>
    word.charAt(0).toUpperCase() + word.slice(1)
  ).join(' ');

  const displayName = await question(`Enter project display name [${defaultName}]: `);
  return displayName.trim() || defaultName;
}

function createFirebaseProject(projectId, displayName) {
  console.log(`\n🚀 Creating Firebase project: ${projectId}...`);
  console.log('   This may take 30-60 seconds...\n');

  try {
    // Create project without enabling Google Analytics
    exec(`firebase projects:create ${projectId} --display-name "${displayName}"`);
    console.log('✅ Firebase project created successfully');
    return true;
  } catch (error) {
    console.error('❌ Failed to create Firebase project');
    console.error('   Common issues:');
    console.error('   - Project ID already exists (try a different ID)');
    console.error('   - Need to set up billing in Google Cloud Console');
    console.error('   - API not enabled in GCP project');
    return false;
  }
}

function addWebApp(projectId) {
  console.log('\n🌐 Registering web app...');

  try {
    const output = exec(
      `firebase apps:create WEB "Interview Analyzer Web" --project ${projectId}`,
      { silent: true }
    );

    // Extract App ID from output
    const appIdMatch = output.match(/App ID: ([^\s]+)/);
    if (appIdMatch) {
      console.log(`✅ Web app registered: ${appIdMatch[1]}`);
      return appIdMatch[1];
    }

    console.log('✅ Web app registered');
    return null;
  } catch (error) {
    console.error('⚠️  Could not register web app automatically');
    console.log('   You can add it manually in Firebase Console');
    return null;
  }
}

function getWebAppConfig(projectId, appId) {
  console.log('\n🔑 Fetching web app configuration...');

  try {
    // Try to get config using Firebase CLI
    const output = exec(
      `firebase apps:sdkconfig WEB ${appId} --project ${projectId}`,
      { silent: true, ignoreError: true }
    );

    if (output) {
      // Parse the JavaScript config output
      const apiKeyMatch = output.match(/apiKey:\s*["']([^"']+)["']/);
      const authDomainMatch = output.match(/authDomain:\s*["']([^"']+)["']/);
      const projectIdMatch = output.match(/projectId:\s*["']([^"']+)["']/);
      const storageBucketMatch = output.match(/storageBucket:\s*["']([^"']+)["']/);
      const messagingSenderIdMatch = output.match(/messagingSenderId:\s*["']([^"']+)["']/);
      const appIdMatch = output.match(/appId:\s*["']([^"']+)["']/);

      if (apiKeyMatch) {
        console.log('✅ Configuration fetched');
        return {
          apiKey: apiKeyMatch[1],
          authDomain: authDomainMatch ? authDomainMatch[1] : `${projectId}.firebaseapp.com`,
          projectId: projectIdMatch ? projectIdMatch[1] : projectId,
          storageBucket: storageBucketMatch ? storageBucketMatch[1] : `${projectId}.appspot.com`,
          messagingSenderId: messagingSenderIdMatch ? messagingSenderIdMatch[1] : '',
          appId: appIdMatch ? appIdMatch[1] : appId
        };
      }
    }
  } catch (error) {
    // Fall through to manual config
  }

  console.log('⚠️  Could not fetch config automatically');
  return null;
}

async function getConfigManually(projectId) {
  console.log('\n📋 Please provide your Firebase configuration');
  console.log('   Get it from: https://console.firebase.google.com/');
  console.log(`   Select project: ${projectId}`);
  console.log('   Go to: Project Settings > General > Your apps > Web app\n');

  const apiKey = await question('Firebase API Key: ');
  const authDomain = await question(`Auth Domain [${projectId}.firebaseapp.com]: `) || `${projectId}.firebaseapp.com`;
  const storageBucket = await question(`Storage Bucket [${projectId}.appspot.com]: `) || `${projectId}.appspot.com`;
  const messagingSenderId = await question('Messaging Sender ID: ');
  const appId = await question('App ID: ');

  return {
    apiKey: apiKey.trim(),
    authDomain: authDomain.trim(),
    projectId,
    storageBucket: storageBucket.trim(),
    messagingSenderId: messagingSenderId.trim(),
    appId: appId.trim()
  };
}

function createEnvFile(config) {
  console.log('\n📝 Creating .env file...');

  const envPath = join(process.cwd(), 'frontend', '.env');

  if (existsSync(envPath)) {
    console.log('⚠️  .env file already exists');
    return false;
  }

  const envContent = `# Firebase Configuration
# Auto-generated by setup-firebase.js

VITE_FIREBASE_API_KEY=${config.apiKey}
VITE_FIREBASE_AUTH_DOMAIN=${config.authDomain}
VITE_FIREBASE_PROJECT_ID=${config.projectId}
VITE_FIREBASE_STORAGE_BUCKET=${config.storageBucket}
VITE_FIREBASE_MESSAGING_SENDER_ID=${config.messagingSenderId}
VITE_FIREBASE_APP_ID=${config.appId}
`;

  try {
    writeFileSync(envPath, envContent, 'utf8');
    console.log(`✅ Created: ${envPath}`);
    return true;
  } catch (error) {
    console.error('❌ Failed to create .env file');
    console.error(error.message);
    return false;
  }
}

function enableAuthentication(projectId) {
  console.log('\n🔐 Enabling authentication methods...');
  console.log('   Note: This step requires manual configuration in Firebase Console');
  console.log(`   Visit: https://console.firebase.google.com/project/${projectId}/authentication/providers`);
  console.log('\n   Enable these providers:');
  console.log('   1. Email/Password - Toggle "Enable" to ON');
  console.log('   2. Google - Toggle "Enable" to ON, enter support email');
  console.log('\n   Press Enter when done...');
}

async function main() {
  console.log('🔥 Firebase Project Setup Script');
  console.log('================================\n');

  // Check prerequisites
  if (!checkFirebaseCLI()) {
    rl.close();
    process.exit(1);
  }

  if (!checkFirebaseLogin()) {
    rl.close();
    process.exit(1);
  }

  // Get project details
  const projectId = await getProjectId();
  if (!projectId) {
    console.error('❌ Project ID is required');
    rl.close();
    process.exit(1);
  }

  const displayName = await getProjectDisplayName(projectId);

  // Confirm before proceeding
  console.log('\n📋 Summary:');
  console.log(`   Project ID: ${projectId}`);
  console.log(`   Display Name: ${displayName}`);

  const confirm = await question('\nProceed with setup? (yes/no): ');
  if (confirm.toLowerCase() !== 'yes' && confirm.toLowerCase() !== 'y') {
    console.log('❌ Setup cancelled');
    rl.close();
    process.exit(0);
  }

  // Create Firebase project
  if (!createFirebaseProject(projectId, displayName)) {
    console.log('\n💡 If project creation failed:');
    console.log('   1. Try a different project ID');
    console.log('   2. Or create manually at: https://console.firebase.google.com/');
    console.log('   3. Then run this script again to configure it');
    rl.close();
    process.exit(1);
  }

  // Add web app
  const appId = addWebApp(projectId);

  // Get configuration
  let config = null;
  if (appId) {
    config = getWebAppConfig(projectId, appId);
  }

  if (!config) {
    const manualSetup = await question('\nSet up configuration manually? (yes/no): ');
    if (manualSetup.toLowerCase() === 'yes' || manualSetup.toLowerCase() === 'y') {
      config = await getConfigManually(projectId);
    }
  }

  // Create .env file
  if (config) {
    createEnvFile(config);
  }

  // Enable authentication
  await enableAuthentication(projectId);
  await question('Press Enter to continue...');

  // Final instructions
  console.log('\n✅ Setup Complete!\n');
  console.log('📋 Next Steps:');
  console.log('   1. Restart your frontend dev server:');
  console.log('      cd frontend && npm run dev');
  console.log('   2. Open http://localhost:5173 in your browser');
  console.log('   3. Test sign-up with email/password');
  console.log('   4. Test sign-in with Google\n');
  console.log('📚 Documentation:');
  console.log(`   Firebase Console: https://console.firebase.google.com/project/${projectId}`);
  console.log('   Setup Guide: ./FIREBASE_SETUP.md\n');

  rl.close();
}

// Run the script
main().catch(error => {
  console.error('\n❌ Setup failed:', error.message);
  rl.close();
  process.exit(1);
});
