import WebSocket from "ws";
import { config } from "./config";
import { validateEnv } from "./utils/env-validator";
import { initTelegram } from "./telegram";
import dotenv from "dotenv";
import { initDB, addToken } from './db/tokenDB';
import { startPriceChecker } from './priceChecker';
import { startDisplay } from './display';
import { startServer } from './server';

// Load environment variables
dotenv.config();

// Initialize environment variables
validateEnv();

// Initialize Telegram (if enabled)
if (config.telegram.enabled) {
  initTelegram();
}

// PumpFun API Types
interface PumpFunTokenData {
  signature: string;
  mint: string;
  traderPublicKey: string;
  txType: string;
  initialBuy: number;
  solAmount: number;
  bondingCurveKey: string;
  vTokensInBondingCurve: number;
  vSolInBondingCurve: number;
  marketCapSol: number;
  name: string;
  symbol: string;
  uri: string;
  pool: string;
}

// Function to send the subscription request
function sendSubscribeRequest(ws: WebSocket): void {
  const payload = {
    method: "subscribeNewToken",
  };
  ws.send(JSON.stringify(payload));
  console.log("✅ Subscribed to PumpFun new token events");
}

// Function to process new token events
async function processNewToken(tokenData: PumpFunTokenData): Promise<void> {
  try {
    if (tokenData.txType !== 'create') {
      return; // Only process token creation events
    }

    console.log(`🔍 New token detected:
    Name: ${tokenData.name}
    Symbol: ${tokenData.symbol}
    Mint: ${tokenData.mint}
    Initial SOL: ${tokenData.solAmount}
    Market Cap: ${tokenData.marketCapSol} SOL`);
    
    // Save token to database
    await addToken({
      mint: tokenData.mint,
      name: tokenData.name,
      symbol: tokenData.symbol,
      initialSolAmount: tokenData.solAmount,
      marketCapSol: tokenData.marketCapSol,
      createdAt: new Date()
    });

  } catch (error) {
    if (error instanceof Error) {
      console.error("❌ Error processing token:", error.message);
    } else {
      console.error("❌ Unknown error processing token");
    }
  }
}

// WebSocket handler function
async function websocketHandler(): Promise<void> {
  const ws = new WebSocket('wss://pumpportal.fun/api/data');
  
  ws.on('open', function open() {
    console.log("🔗 Connected to PumpFun WebSocket");
    sendSubscribeRequest(ws);
  });
  
  ws.on('message', async function message(data: WebSocket.RawData) {
    try {
      const rawData = data.toString();
      const parsedData: PumpFunTokenData = JSON.parse(rawData);
      await processNewToken(parsedData);
    } catch (error) {
      if (error instanceof Error) {
        console.error("❌ Error processing message:", error.message);
      }
    }
  });
  
  ws.on('error', function error(err) {
    console.error("❌ WebSocket error:", err);
  });
  
  ws.on('close', function close() {
    console.log("🔄 WebSocket connection closed, attempting to reconnect...");
    setTimeout(websocketHandler, 5000); // Reconnect after 5 seconds
  });
}

// Main function
async function main(): Promise<void> {
  try {
    console.log("🚀 Starting PumpFun token scanner...");

    // Start web server
    await startServer();
    
    // Initialize database
    await initDB();
    console.log("✅ Database initialized");

    // Start price checker
    await startPriceChecker();
    console.log("✅ Price checker started");
    
    // Start real-time display
    await startDisplay();
    
    // Start WebSocket handler
    await websocketHandler();
  } catch (error) {
    if (error instanceof Error) {
      console.error("❌ Fatal error:", error.message);
      process.exit(1);
    }
  }
}

// Start the application
main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error("❌ Fatal error:", error.message);
  }
  process.exit(1);
});
