#!/usr/bin/env node

/**
 * Script to make a user an admin in Firestore
 * Usage: node make-admin.js <email>
 * Example: node make-admin.js scottmsilver@gmail.com
 */

import admin from 'firebase-admin';

// Initialize Firebase Admin with application default credentials
admin.initializeApp({
  projectId: 'interview-analyzer-prod'
});

const db = admin.firestore();
const auth = admin.auth();

async function makeAdmin(email) {
  try {
    console.log(`\n🔍 Looking up user: ${email}`);

    // Get user by email
    const userRecord = await auth.getUserByEmail(email);
    console.log(`✅ Found user: ${userRecord.email}`);
    console.log(`   UID: ${userRecord.uid}`);

    // Check if already admin
    const adminDoc = await db.collection('admins').doc(userRecord.uid).get();
    if (adminDoc.exists) {
      console.log(`\n⚠️  User is already an admin!`);
      return;
    }

    // Create admin document
    await db.collection('admins').doc(userRecord.uid).set({
      email: email,
      role: 'admin',
      createdAt: new Date().toISOString(),
      permissions: ['approve_users', 'view_all_users']
    });

    console.log(`\n✅ Successfully made ${email} an admin!`);
    console.log(`   Admin UID: ${userRecord.uid}`);
    console.log(`\n🎉 The user will now see the Admin Dashboard when they sign in.`);

  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.error(`\n❌ User not found: ${email}`);
      console.error(`   Please make sure the user has signed up first at:`);
      console.error(`   https://interview-analyzer-prod.web.app\n`);
    } else {
      console.error(`\n❌ Error:`, error.message);
    }
  }
}

// Get email from command line argument
const email = process.argv[2];

if (!email) {
  console.error(`
❌ Usage: node make-admin.js <email>

Example:
  node make-admin.js scottmsilver@gmail.com
`);
  process.exit(1);
}

// Run the script
makeAdmin(email).then(() => process.exit(0)).catch(err => {
  console.error('Fatal error:', err);
  process.exit(1);
});
