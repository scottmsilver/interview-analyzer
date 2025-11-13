#!/usr/bin/env node

// Script to set up admin user in Firestore
// Run with: node setup-admin.js

import { initializeApp, cert } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { getAuth } from 'firebase-admin/auth';

// Initialize Firebase Admin
const app = initializeApp({
  projectId: 'interview-analyzer-prod'
});

const db = getFirestore(app);
const auth = getAuth(app);

async function setupAdmin() {
  const adminEmail = 'scottmsilver@gmail.com';

  try {
    // Get user by email
    const userRecord = await auth.getUserByEmail(adminEmail);
    console.log(`Found user: ${userRecord.email} (${userRecord.uid})`);

    // Create admin document
    await db.collection('admins').doc(userRecord.uid).set({
      email: adminEmail,
      role: 'admin',
      createdAt: new Date().toISOString(),
      permissions: ['approve_users', 'view_all_users']
    });

    console.log('✅ Admin user created successfully!');
    console.log(`Admin UID: ${userRecord.uid}`);

  } catch (error) {
    if (error.code === 'auth/user-not-found') {
      console.error('❌ User not found. Please sign up first at https://interview-analyzer-prod.web.app');
    } else {
      console.error('Error setting up admin:', error);
    }
  }

  process.exit(0);
}

setupAdmin();
