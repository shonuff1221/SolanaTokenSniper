import WebSocket from 'ws';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Create a WebSocket connection to PumpPortal
console.log('Connecting to PumpPortal API...');
const ws = new WebSocket('wss://pumpportal.fun/api/data');

// Handle connection open
ws.on('open', function open() {
  console.log('✅ Connected to PumpPortal API');

  // Subscribing to token creation events
  // let payload = {
  //   method: "subscribeNewToken"
  // };
  // ws.send(JSON.stringify(payload));
  // console.log('✅ Subscribed to token creation events');

  // Subscribing to migration events
  const payload = {
    method: "subscribeMigration"
  };
  ws.send(JSON.stringify(payload));
  console.log('✅ Subscribed to migration events');
});

// Handle incoming messages
ws.on('message', function message(data) {
  try {
    const parsedData = JSON.parse(data.toString());
    console.log('\n📥 Received event:');
    console.log(JSON.stringify(parsedData, null, 2));
    
    // Extract and log specific event details
    if (parsedData.type) {
      console.log(`Event type: ${parsedData.type}`);
      
      if (parsedData.type === 'newToken' && parsedData.data) {
        console.log(`🔔 New token created: ${parsedData.data.mint} (${parsedData.data.name || 'Unknown'})`);
      }
      else if (parsedData.type === 'migration' && parsedData.data) {
        console.log(`🔄 Token migration detected: ${parsedData.data.oldMint} -> ${parsedData.data.newMint}`);
      }
      else if (parsedData.type === 'accountTrade' && parsedData.data) {
        console.log(`👤 Account trade detected for: ${parsedData.data.account}`);
      }
      else if (parsedData.type === 'tokenTrade' && parsedData.data) {
        console.log(`💱 Token trade detected for: ${parsedData.data.mint}`);
      }
    }
  } catch (error) {
    console.error('❌ Error parsing message:', error);
    console.log('Raw message:', data.toString());
  }
});

// Handle errors
ws.on('error', function error(err) {
  console.error('❌ WebSocket error:', err);
});

// Handle connection close
ws.on('close', function close() {
  console.log('📴 Connection closed');
});

// Handle process termination
process.on('SIGINT', () => {
  console.log('\nClosing connection...');
  ws.close();
  setTimeout(() => {
    console.log('Exiting...');
    process.exit(0);
  }, 1000);
})
