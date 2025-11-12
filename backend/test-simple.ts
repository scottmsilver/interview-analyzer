import { analyzeInterview } from './src/analyzer.js';

const simpleTranscript = `
Interviewer: Tell me about a product you use daily and how you would improve it.

Candidate: I use Spotify every day. One improvement I'd suggest is adding a collaborative queue feature where friends can add songs in real-time during a party or road trip. This would solve the problem of one person being the DJ all the time.

Interviewer: How would you measure success for this feature?

Candidate: I'd look at engagement metrics like the number of collaborative sessions created per week, average session duration, and user retention for people who use this feature versus those who don't.
`;

console.log('🚀 Starting simple analysis test...\n');

async function test() {
  try {
    const generator = await analyzeInterview(simpleTranscript, {
      interviewType: 'generic'
    });

    for await (const message of generator) {
      console.log('---');
      console.log('Type:', message.type);
      console.log('Content:', message.content?.substring(0, 200));
      if (message.tool) {
        console.log('Tool:', message.tool);
      }
      if (message.fullContent) {
        console.log('Full thinking:', message.fullContent.substring(0, 300));
      }
      console.log('');
    }

    console.log('\n✅ Test complete!');
  } catch (error) {
    console.error('❌ Test failed:', error);
  }
}

test();
