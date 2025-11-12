/**
 * Test script to verify the analyzer works
 */

import { analyzeInterview } from './analyzer.js';
import * as fs from 'fs';
import * as path from 'path';
import dotenv from 'dotenv';

dotenv.config();

async function testAnalyzer() {
  console.log('🧪 Testing Interview Analyzer\n');

  // Check for API key
  if (!process.env.ANTHROPIC_API_KEY) {
    console.error('❌ Error: ANTHROPIC_API_KEY environment variable not set');
    console.error('   Please create a .env file with your Anthropic API key\n');
    process.exit(1);
  }

  // Read the sample transcript
  const transcriptPath = path.join(process.cwd(), '../../transcript');

  if (!fs.existsSync(transcriptPath)) {
    console.error(`❌ Error: Transcript file not found at ${transcriptPath}`);
    console.error('   Please provide a transcript file to test with\n');
    process.exit(1);
  }

  const transcript = fs.readFileSync(transcriptPath, 'utf-8');
  console.log(`📄 Loaded transcript: ${transcript.length} characters\n`);

  // Run analysis
  console.log('🤖 Starting analysis with Claude Agent SDK...\n');
  console.log('=' .repeat(80));
  console.log('\n');

  try {
    const generator = await analyzeInterview(transcript, {
      interviewType: 'google-apm'
    });

    let totalContent = '';
    let messageCount = 0;
    for await (const message of generator) {
      messageCount++;
      console.log(`\n[Message ${messageCount}, type: ${message.type}]`);
      process.stdout.write(message.content);
      totalContent += message.content;
    }

    console.log('\n\n');
    console.log('=' .repeat(80));
    console.log(`\n✅ Analysis complete! (${totalContent.length} characters)\n`);

  } catch (error) {
    console.error('\n❌ Analysis failed:', error);
    process.exit(1);
  }
}

// Run the test
testAnalyzer().catch(console.error);
