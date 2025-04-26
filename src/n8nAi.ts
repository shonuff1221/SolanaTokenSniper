import WebSocket from "ws";
import axios from "axios";
import dotenv from "dotenv";
import { config } from "./config";
import { validateEnv } from "./utils/env-validator";
import { initTelegram } from "./telegram";
import path from "path";
import fs from "fs";

// Load environment variables
dotenv.config();

// Initialize environment variables
validateEnv();

// Initialize Telegram (if enabled)
if (config.telegram.enabled) {
  initTelegram();
}

// Types
interface WebSocketRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: unknown[];
}

interface MintsDataResponse {
  tokenMint: string;
  solMint: string;
  timestamp: number;
}

interface TransactionInstruction {
  programId: string;
  accounts: string[];
}

interface TransactionDetails {
  instructions: TransactionInstruction[];
  blockTime?: number;
}

interface TopHolder {
  address: string;
  amount: number;
  share: number;
}

interface Market {
  address: string;
  liquidity: number;
  lpProviders: number;
}

interface RugResponseExtended {
  token: {
    mintAuthority: string;
    freezeAuthority: string;
    isInitialized: boolean;
  };
  tokenMeta: {
    name: string;
    symbol: string;
    mutable: boolean;
  };
  detectedAt: string;
  topHolders: TopHolder[];
  markets: Market[];
  totalLPProviders: number;
  totalMarketLiquidity: number;
  rugged: boolean;
  score: number;
  risks?: {
    name: string;
    value: string;
    description: string;
    score: number;
    level: string;
  }[];
}

// We'll use environment variables for webhook configuration
// WEBHOOK_URL - The URL to send token information to
// WEBHOOK_TIMEOUT - Timeout in milliseconds for webhook requests (default: 10000)

// PumpPortal API types
interface PumpPortalNewTokenEvent {
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
  timestamp?: number; // Optional timestamp
}

interface PumpPortalMigrationEvent {
  signature: string;
  mint: string;
  txType: string;
  pool: string;
  [key: string]: unknown;
}

// PumpPortal WebSocket connection
let pumpPortalWs: WebSocket | null = null;

async function getTokenCreationTime(tokenMint: string): Promise<number | null> {
  try {
    // Wait briefly for token to be indexed
    await new Promise((resolve) => setTimeout(resolve, 2000));

    const response = await axios.get<RugResponseExtended>(
      `https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`,
      {
        timeout: config.tx.get_timeout,
      }
    );

    if (response.data && response.data.detectedAt) {
      const createdAt = new Date(response.data.detectedAt);
      return Math.floor(createdAt.getTime() / 1000);
    }
    return null;
  } catch (error) {
    if (error instanceof Error && error.message.includes("404")) {
      console.log("Token not yet indexed on rugcheck, using current time");
    } else {
      console.error("Error fetching token creation time:", error);
    }
    return null;
  }
}

async function fetchTransactionDetails(
  signature: string
): Promise<MintsDataResponse | null> {
  const txUrl = process.env.HELIUS_HTTPS_URI_TX || "";

  if (!txUrl) {
    console.error("❌ HELIUS_HTTPS_URI_TX is not set in .env file");
    return null;
  }

  const maxRetries = 5;
  let retryCount = 0;

  // Initial delay
  const initialDelay = 2000;
  console.log(`⏳ Waiting for transaction confirmation...`);
  await new Promise((resolve) => setTimeout(resolve, initialDelay));

  while (retryCount < maxRetries) {
    try {
      const requestBody = {
        transactions: [signature],
        commitment: "confirmed",
        encoding: "jsonParsed",
      };

      const response = await axios.post<TransactionDetails[]>(
        txUrl,
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      // Verify if a response was received
      if (!response.data) {
        throw new Error("No response data received");
      }

      // Verify if the response was in the correct format and not empty
      if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new Error("Response data array is empty");
      }

      const transactions = response.data;

      // Verify if transaction details were found
      if (!transactions[0]) {
        throw new Error("Transaction not found");
      }

      // Access the `instructions` property which contains account instructions
      const instructions = transactions[0].instructions;
      if (
        !instructions ||
        !Array.isArray(instructions) ||
        instructions.length === 0
      ) {
        throw new Error("No instructions found in transaction");
      }

      // Verify and find the instructions for the correct market maker id
      const instruction = instructions.find(
        (ix) => ix.programId === config.liquidity_pool.radiyum_program_id
      );
      if (!instruction || !instruction.accounts) {
        throw new Error("No market maker instruction found");
      }
      if (
        !Array.isArray(instruction.accounts) ||
        instruction.accounts.length < 10
      ) {
        throw new Error("Invalid accounts array in instruction");
      }

      // Store quote and token mints
      const accountOne = instruction.accounts[8];
      const accountTwo = instruction.accounts[9];

      // Verify if we received both quote and token mints
      if (!accountOne || !accountTwo) {
        throw new Error("Required accounts not found");
      }

      // Set new token and SOL mint
      let solTokenAccount = "";
      let newTokenAccount = "";
      if (accountOne === config.liquidity_pool.wsol_pc_mint) {
        solTokenAccount = accountOne;
        newTokenAccount = accountTwo;
      } else {
        solTokenAccount = accountTwo;
        newTokenAccount = accountOne;
      }

      console.log(`✅ Found new token: ${newTokenAccount}`);

      // Get token creation time from rugcheck
      const tokenTime = await getTokenCreationTime(newTokenAccount);
      const currentTime = Math.floor(Date.now() / 1000);
      const timestamp = tokenTime || currentTime;

      return {
        tokenMint: newTokenAccount,
        solMint: solTokenAccount,
        timestamp: timestamp,
      };
    } catch (error) {
      if (error instanceof Error) {
        console.log(`❌ Attempt ${retryCount + 1} failed: ${error.message}`);
      }

      retryCount++;

      if (retryCount < maxRetries) {
        const delay = Math.min(2000 * Math.pow(1.5, retryCount), 20000);
        console.log(`⏳ Retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.log("❌ Failed to fetch transaction details");
  return null;
}

/**
 * Send token information to a webhook
 * @param tokenMint The token mint address
 * @param customPayload Optional custom payload to send instead of generating one
 * @returns Promise<boolean> true if successful, false otherwise
 */
async function sendTokenToWebhook(
  tokenMint: string,
  customPayload?: Record<string, unknown>
): Promise<boolean> {
  try {
    // Check if webhook is enabled in config
    if (!process.env.WEBHOOK_URL) {
      console.log("❌ WEBHOOK_URL not set in environment variables");
      return false;
    }

    const webhookUrl = process.env.WEBHOOK_URL;
    const webhookTimeout = parseInt(process.env.WEBHOOK_TIMEOUT || "10000");

    console.log(`🔄 Sending token to webhook: ${tokenMint}`);

    // Get token creation time
    const creationTime = await getTokenCreationTime(tokenMint);

    // Use custom payload if provided, otherwise create a default one
    const payload = customPayload || {
      tokenAddress: tokenMint,
      source: "helius",
      timestamp: new Date().toISOString(),
      creationTime: creationTime
        ? new Date(creationTime * 1000).toISOString()
        : null,
      links: {
        axiom: `https://axiom.trade/meme/${tokenMint}`,
        gmgn: `https://gmgn.ai/sol/token/${tokenMint}`,
        bullx: `https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenMint}`,
        solscan: `https://solscan.io/token/${tokenMint}`,
        raydium: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${tokenMint}`,
        jupiter: `https://jup.ag/swap/SOL-${tokenMint}`,
      },
      prompt: `What are the chances of this token ${tokenMint} deployed on the solana blockchain and the pumpfun platform being a rug versus it becoming a token that can reach atleast 1 million dollar marketcap, use the tools you have to get all the details of this token give it a score of 1-100 100 being the best`,
    };

    // Send to webhook
    const response = await axios.post(webhookUrl, payload, {
      headers: {
        "Content-Type": "application/json",
      },
      timeout: webhookTimeout,
    });

    if (response.status >= 200 && response.status < 300) {
      console.log(
        `✅ Successfully sent token to webhook (Status: ${response.status})`
      );

      // Save webhook response to log file
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const outputFile = path.join(
        process.cwd(),
        "data",
        `webhook-${tokenMint}-${timestamp}.json`
      );

      // Ensure data directory exists
      const dataDir = path.join(process.cwd(), "data");
      if (!fs.existsSync(dataDir)) {
        fs.mkdirSync(dataDir, { recursive: true });
      }

      fs.writeFileSync(
        outputFile,
        JSON.stringify(
          {
            tokenAddress: tokenMint,
            sentAt: new Date().toISOString(),
            webhookUrl,
            payload,
            response: {
              status: response.status,
              statusText: response.statusText,
              data: response.data,
            },
          },
          null,
          2
        )
      );

      console.log(`💾 Saved webhook response to: ${path.basename(outputFile)}`);
      return true;
    } else {
      console.error(`❌ Failed to send to webhook. Status: ${response.status}`);
      return false;
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("❌ Error sending to webhook:", error.message);
    } else {
      console.error("❌ Unknown error sending to webhook");
    }
    return false;
  }
}

// Function to send the subscription request
function sendSubscribeRequest(ws: WebSocket): void {
  console.log("📡 Sending subscription request...");
  const request: WebSocketRequest = {
    jsonrpc: "2.0",
    id: "1",
    method: "logsSubscribe",
    params: [
      {
        mentions: [config.liquidity_pool.radiyum_program_id],
      },
      {
        commitment: "processed",
      },
    ],
  };
  ws.send(JSON.stringify(request));
}

// Function to process a transaction
async function processTransaction(signature: string): Promise<void> {
  try {
    console.log("⏳ Waiting for transaction confirmation...");
    const txInfo = await fetchTransactionDetails(signature);

    if (!txInfo) {
      console.log("❌ Could not fetch transaction info");
      return;
    }

    const { tokenMint, timestamp } = txInfo;

    // Check if token is too old using config value
    const now = Math.floor(Date.now() / 1000);
    const minutesOld = (now - timestamp) / 60;
    const maxAge = config.twitter_search?.max_token_age_minutes || 40;

    if (minutesOld > maxAge) {
      console.log(
        `❌ Token is ${Math.round(
          minutesOld
        )} minutes old. Skipping tokens older than ${maxAge} minutes.`
      );
      return;
    }

    console.log(
      `✅ Found new token: ${tokenMint} (${Math.round(minutesOld)} minutes old)`
    );

    // Output logs
    console.log("Token found");
    console.log("👽 GMGN: https://gmgn.ai/sol/token/" + tokenMint);
    console.log(
      "😈 BullX: https://neo.bullx.io/terminal?chainId=1399811149&address=" +
        tokenMint
    );

    // Send token to webhook
    console.log("🔄 Sending token to webhook...");
    const webhookSuccess = await sendTokenToWebhook(tokenMint);

    if (!webhookSuccess) {
      console.log(
        "⚠️ Failed to send to webhook, but continuing with Telegram notification if enabled."
      );
    } else {
      console.log("✅ Token address sent to webhook successfully.");
    }

    // Send token to group if telegram is enabled
    // if (config.telegram.enabled) {
    //   console.log("🔄 Sending token to Telegram...");
    //   await sendTokenToGroup(tokenMint);
    //   console.log("✅ Token address sent to Telegram successfully.");
    // }

    console.log("🟢 Resuming looking for new tokens...\n");
  } catch (error) {
    console.error("Error processing transaction:", error);
  }
}

// Main function to start the WebSocket connections
let init = false;
let activeTransactions = 0;
const MAX_CONCURRENT = 10;

/**
 * Initialize and handle PumpPortal WebSocket connection
 */
async function initPumpPortalWebSocket(): Promise<void> {
  try {
    // Close existing connection if any
    if (pumpPortalWs) {
      try {
        pumpPortalWs.terminate();
      } catch (err) {
        console.error("Error terminating existing connection:", err);
      }
      pumpPortalWs = null;
    }

    console.log("🔄 Connecting to PumpPortal API...");
    pumpPortalWs = new WebSocket("wss://pumpportal.fun/api/data");

    pumpPortalWs!.on("open", function () {
      console.log("✅ Connected to PumpPortal API");

      // Subscribe to migration events
      const migrationPayload = {
        method: "subscribeMigration",
      };
      pumpPortalWs!.send(JSON.stringify(migrationPayload));
      console.log("✅ Subscribed to migration events");

      // Subscribe to token creation events
      //   const newTokenPayload = {
      //     method: "subscribeNewToken"
      //   };
      //   pumpPortalWs!.send(JSON.stringify(newTokenPayload));
      //   console.log("✅ Subscribed to token creation events");
    });

    pumpPortalWs!.on("message", async function (data) {
      try {
        const parsedData = JSON.parse(data.toString());

        // Check if it's a subscription confirmation message
        if (parsedData.message && typeof parsedData.message === "string") {
          console.log(`✅ PumpPortal: ${parsedData.message}`);
          return;
        }

        // Check for migration event based on the actual format
        if (parsedData.txType === "migrate" && parsedData.mint) {
          const migrationData = parsedData as PumpPortalMigrationEvent;
          console.log(
            `🔄 Token migration detected: ${migrationData.mint} (${migrationData.pool})`
          );
          console.log(`🔄 Migration signature: ${migrationData.signature}`);

          // Process the migration event
          await processPumpPortalToken(
            migrationData.mint,
            "migration",
            migrationData
          );
        }
      } catch (error) {
        console.error("❌ Error processing PumpPortal message:", error);
      }
    });

    pumpPortalWs!.on("error", function (error) {
      console.error("❌ PumpPortal WebSocket error:", error);
    });

    pumpPortalWs!.on("close", function () {
      console.log("📴 PumpPortal WebSocket connection closed");
      console.log("🔄 Attempting to reconnect in 5 seconds...");

      // Attempt to reconnect after a delay
      setTimeout(() => {
        initPumpPortalWebSocket().catch(console.error);
      }, 5000);
    });
  } catch (error) {
    console.error("❌ Error initializing PumpPortal WebSocket:", error);
    console.log("🔄 Attempting to reconnect in 10 seconds...");

    // Attempt to reconnect after a longer delay
    setTimeout(() => {
      initPumpPortalWebSocket().catch(console.error);
    }, 10000);
  }
}

/**
 * Process a token from PumpPortal API
 * @param tokenMint The token mint address
 * @param eventType The type of event (creation or migration)
 * @param eventData Additional event data
 */
async function processPumpPortalToken(
  tokenMint: string,
  eventType: "creation" | "migration",
  eventData: PumpPortalNewTokenEvent | PumpPortalMigrationEvent
): Promise<void> {
  try {
    console.log(`🔍 Processing ${eventType} event for token: ${tokenMint}`);

    // Send to webhook
    console.log("🔄 Sending token to webhook...");

    // Get token creation time (if not provided in the event data)
    let creationTime = "Unknown";
    if ("timestamp" in eventData && typeof eventData.timestamp === "number") {
      creationTime = new Date(eventData.timestamp * 1000).toISOString();
    } else {
      const timestamp = await getTokenCreationTime(tokenMint);
      if (timestamp) {
        creationTime = new Date(timestamp * 1000).toISOString();
      }
    }
    const finalAnswer = "";

    // Prepare payload
    const payload = {
      tokenAddress: tokenMint,
      source: "pumpportal",
      eventType: eventType,
      timestamp: new Date().toISOString(),
      creationTime: creationTime !== "Unknown" ? creationTime : null,
      eventData: eventData,
      finalAnswer: finalAnswer,
      links: {
        axiom: `https://axiom.trade/meme/${tokenMint}`,
        gmgn: `https://gmgn.ai/sol/token/${tokenMint}`,
        bullx: `https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenMint}`,
        solscan: `https://solscan.io/token/${tokenMint}`,
        raydium: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${tokenMint}`,
        jupiter: `https://jup.ag/swap/SOL-${tokenMint}`,
      },
      prompt: `What are the chances of this token ${tokenMint} deployed on the solana blockchain being a rug versus
      it becoming a token that can go atleast 60% higher than the current marketcap, use the tools you have to get all the details of this token give 
      it a score of 1-100 100 being the best, Give me a ${finalAnswer ? "BUY" : "Stay Away"} in your opinion to buy this token or not to gain profit of atleast 40%`,
    };

    // Send to webhook
    const webhookSuccess = await sendTokenToWebhook(tokenMint, payload);

    if (!webhookSuccess) {
      console.log("⚠️ Failed to send PumpPortal event to webhook");
    } else {
      console.log("✅ PumpPortal event sent to webhook successfully");
    }
  } catch (error) {
    console.error(`❌ Error processing PumpPortal ${eventType} event:`, error);
  }
}

async function websocketHandler(): Promise<void> {
  // Load environment variables from the .env file
  const env = validateEnv();

  // Create a WebSocket connection
  let ws: WebSocket | null = new WebSocket(env.HELIUS_WSS_URI);
  if (!init) console.clear();

  // Send subscription to the websocket once the connection is open
  ws.on("open", () => {
    if (ws) sendSubscribeRequest(ws);
    console.log("\n🔓 WebSocket is open and listening.");
    init = true;
  });

  // Logic for the message event for the .on event listener
  ws.on("message", async (data: WebSocket.Data) => {
    try {
      const jsonString = data.toString();
      const parsedData = JSON.parse(jsonString);

      // Handle subscription response
      if (parsedData.result !== undefined && !parsedData.error) {
        console.log("✅ Subscription confirmed");
        return;
      }

      // Only log RPC errors for debugging
      if (parsedData.error) {
        console.error("🚫 RPC Error:", parsedData.error);
        return;
      }

      // Safely access the nested structure
      const logs = parsedData?.params?.result?.value?.logs;
      const signature = parsedData?.params?.result?.value?.signature;

      // Validate `logs` is an array and if we have a signature
      if (!Array.isArray(logs) || !signature) return;

      // Verify if this is a new pool creation
      const containsCreate = logs.some(
        (log: string) =>
          typeof log === "string" &&
          log.includes("Program log: initialize2: InitializeInstruction2")
      );
      if (!containsCreate || typeof signature !== "string") return;

      // Verify if we have reached the max concurrent transactions
      if (activeTransactions >= MAX_CONCURRENT) {
        console.log("⏳ Max concurrent transactions reached, skipping...");
        return;
      }

      // Add additional concurrent transaction
      activeTransactions++;

      // Process transaction asynchronously
      processTransaction(signature)
        .catch((error) => {
          console.error("Error processing transaction:", error);
        })
        .finally(() => {
          activeTransactions--;
        });
    } catch (error) {
      console.error("💥 Error processing message:", {
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  ws.on("error", (err: Error) => {
    console.error("WebSocket error:", err);
  });

  ws.on("close", () => {
    console.log("📴 WebSocket connection closed, cleaning up...");
    if (ws) {
      ws.removeAllListeners();
      ws = null;
    }
    console.log("🔄 Attempting to reconnect in 5 seconds...");
    setTimeout(websocketHandler, 5000);
  });
}

// Main function
async function main(): Promise<void> {
  try {
    // Validate environment variables
    validateEnv();

    // Initialize Telegram if enabled
    if (config.telegram.enabled) {
      await initTelegram();
    }

    // Check if webhook URL is set
    if (!process.env.WEBHOOK_URL) {
      console.log(
        "⚠️ WEBHOOK_URL not set in environment variables. Tokens will not be sent to webhook."
      );
    } else {
      console.log(`✅ Webhook URL configured: ${process.env.WEBHOOK_URL}`);
    }

    // Handle cleanup on process exit
    const cleanup = async () => {
      console.log("\nCleaning up...");
      if (pumpPortalWs) {
        console.log("Closing PumpPortal WebSocket connection...");
        pumpPortalWs.terminate();
        pumpPortalWs = null;
      }
      process.exit();
    };

    process.on("SIGINT", cleanup);
    process.on("SIGTERM", cleanup);

    // Initialize PumpPortal WebSocket
    await initPumpPortalWebSocket();

    // Start Helius WebSocket handler
    await websocketHandler();
  } catch (error) {
    console.error("Error starting application:", error);
    process.exit(1);
  }
}

// Start the application
main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error("Fatal error:", error.message);
  }
  process.exit(1);
});
