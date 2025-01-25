import WebSocket from "ws";
import axios from "axios";
import dotenv from "dotenv";
import { config } from "./config";
import { BrowserManager } from './testBrowser';
import { validateEnv } from "./utils/env-validator";
import { initTelegram, sendTokenToGroup } from "./telegram";
import path from 'path';
import fs from 'fs';

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
}

interface TransactionInstruction {
  programId: string;
  accounts: string[];
}

interface TransactionDetails {
  instructions: TransactionInstruction[];
}

// Create a singleton browser manager
let browserManager: BrowserManager | null = null;

async function getBrowserManager(): Promise<BrowserManager> {
  if (!browserManager) {
    browserManager = new BrowserManager();
    await browserManager.initialize();
  }
  return browserManager;
}

async function fetchTransactionDetails(signature: string): Promise<MintsDataResponse | null> {
  const txUrl = process.env.HELIUS_HTTPS_URI_TX || "";
  
  if (!txUrl) {
    console.error("❌ HELIUS_HTTPS_URI_TX is not set in .env file");
    return null;
  }

  const maxRetries = 5;
  let retryCount = 0;

  // Initial delay
  const initialDelay = 4000;
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
      if (!instructions || !Array.isArray(instructions) || instructions.length === 0) {
        throw new Error("No instructions found in transaction");
      }

      // Verify and find the instructions for the correct market maker id
      const instruction = instructions.find((ix) => ix.programId === config.liquidity_pool.radiyum_program_id);
      if (!instruction || !instruction.accounts) {
        throw new Error("No market maker instruction found");
      }
      if (!Array.isArray(instruction.accounts) || instruction.accounts.length < 10) {
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

      return {
        tokenMint: newTokenAccount,
        solMint: solTokenAccount,
      };
    } catch (error) {
      if (error instanceof Error) {
        console.log(`❌ Attempt ${retryCount + 1} failed: ${error.message}`);
      }

      retryCount++;

      if (retryCount < maxRetries) {
        const delay = Math.min(4000 * Math.pow(1.5, retryCount), 20000);
        console.log(`⏳ Retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.log("❌ Failed to fetch transaction details");
  return null;
}

async function searchTwitterForToken(tokenMint: string): Promise<boolean> {
  try {
    const manager = await getBrowserManager();
    
    console.log(`🔍 Searching Twitter for token: ${tokenMint}`);
    const tweets = await manager.searchToken(tokenMint);
    
    if (!tweets || tweets.length === 0) {
      console.log('❌ No Twitter activity found for this token');
      return false;
    }

    // Analysis criteria from config
    const minimumTweets = config.twitter_search?.minimum_tweets || 2;
    const minimumUniqueAuthors = config.twitter_search?.minimum_unique_authors || 2;
    const maximumTweetAge = config.twitter_search?.maximum_tweet_age_minutes || 10;
    const excludedUsers = (config.twitter_search?.excluded_users || []).map(u => u.toLowerCase());
    const matchedUsers = (config.twitter_search?.matched_users || []).map(u => u.toLowerCase());
    
    console.log('\n📊 Tweet Analysis:');
    console.log('Found tweets from authors:', tweets.map(t => t.author).join(', '));
    console.log('Excluded users:', excludedUsers.join(', '));
    console.log('Watching for matched users:', matchedUsers.join(', '));
    
    // Filter out tweets from excluded users
    const validTweets = tweets.filter(tweet => {
      const authorLower = tweet.author.toLowerCase();
      const isExcluded = excludedUsers.includes(authorLower);
      if (isExcluded) {
        console.log(`🚫 Excluding tweet from: ${tweet.author}`);
      }
      return !isExcluded;
    });
    
    // Check tweet age
    const now = new Date();
    const oldestAllowedTime = new Date(now.getTime() - (maximumTweetAge * 60 * 1000));
    
    const recentValidTweets = validTweets.filter(tweet => {
      const tweetTime = new Date(tweet.timestamp);
      const isRecent = tweetTime > oldestAllowedTime;
      if (!isRecent) {
        console.log(`⏰ Tweet from ${tweet.author} is too old: ${new Date(tweet.timestamp).toLocaleString()}`);
      }
      return isRecent;
    });

    // Get unique authors (excluding excluded users)
    const uniqueAuthors = new Set(recentValidTweets.map(t => t.author.toLowerCase()));
    
    // Check for matched users and send notification if found
    console.log('\n🔍 Checking for matched users...');
    const matchedTweets = recentValidTweets.filter(tweet => {
      const authorLower = tweet.author.toLowerCase();
      const isMatched = matchedUsers.includes(authorLower);
      console.log(`Checking ${tweet.author.toLowerCase()} against matched users...`);
      if (isMatched) {
        console.log(`✨ Found matched user tweet from: ${tweet.author}`);
      }
      return isMatched;
    });

    if (matchedTweets.length > 0 && config.telegram.enabled) {
      console.log(`\n🔥 Found ${matchedTweets.length} tweets from matched users!`);
      console.log('Matched tweets from:', matchedTweets.map(t => t.author).join(', '));
      
      // Create notification message
      const message = [
        `🚨 *Important User Alert* 🚨`,
        `Token: \`${tokenMint}\``,
        `\nTweets from matched users:`,
        ...matchedTweets.map((tweet, i) => [
          `\n${i + 1}. @${tweet.author}:`,
          `${tweet.text.slice(0, 200)}...`,
          `Time: ${new Date(tweet.timestamp).toLocaleString()}`
        ].join('\n')),
        `\nTotal matched users tweeting: ${matchedTweets.length}`
      ].join('\n');

      // Send to Telegram immediately
      console.log('📱 Sending Telegram notification for matched users...');
      await sendTokenToGroup(message);
      console.log('✅ Telegram notification sent!');
    }
    
    // Log analysis results
    console.log(`\n📊 Analysis Results:`);
    console.log(`Found ${recentValidTweets.length} valid tweets from ${uniqueAuthors.size} unique authors`);
    if (excludedUsers.length > 0) {
      console.log(`Excluded ${tweets.length - validTweets.length} tweets from excluded users`);
    }
    
    // Check minimum requirements
    if (recentValidTweets.length < minimumTweets) {
      console.log(`❌ Not enough valid tweets (found: ${recentValidTweets.length}, required: ${minimumTweets})`);
      return false;
    }
    
    if (uniqueAuthors.size < minimumUniqueAuthors) {
      console.log(`❌ Not enough unique valid authors (found: ${uniqueAuthors.size}, required: ${minimumUniqueAuthors})`);
      return false;
    }
    
    // Token passed all checks - save the valid tweets
    console.log('✅ Token has sufficient Twitter activity!');
    
    // Save only the valid tweets that passed all checks
    const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
    const outputFile = path.join(process.cwd(), 'data', `tweets-${tokenMint}-${timestamp}.json`);
    
    // Ensure data directory exists
    const dataDir = path.join(process.cwd(), 'data');
    if (!fs.existsSync(dataDir)) {
      fs.mkdirSync(dataDir, { recursive: true });
    }

    fs.writeFileSync(outputFile, JSON.stringify({
      tokenAddress: tokenMint,
      searchTime: new Date().toISOString(),
      timeWindow: `${maximumTweetAge} minutes`,
      tweetCount: recentValidTweets.length,
      uniqueAuthors: Array.from(uniqueAuthors),
      tweets: recentValidTweets
    }, null, 2));
    
    console.log(`💾 Saved ${recentValidTweets.length} valid tweets to: ${path.basename(outputFile)}`);
    
    // Display tweet info
    recentValidTweets.forEach((tweet, index) => {
      console.log(`\nTweet ${index + 1}:`);
      console.log(`Author: @${tweet.author}`);
      console.log(`Time: ${new Date(tweet.timestamp).toLocaleString()}`);
      console.log(`Content: ${tweet.text.slice(0, 100)}...`);
    });
    
    return true;
    
  } catch (error) {
    if (error instanceof Error) {
      console.error("Error during Twitter search:", error.message);
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
  // Output logs
  console.log("=============================================");
  console.log("🔎 New Liquidity Pool found.");
  console.log("🔃 Fetching transaction details ...");

  // Fetch the transaction details
  const data = await fetchTransactionDetails(signature);
  if (!data) {
    console.log("⛔ Transaction aborted. No data returned.");
    console.log("🟢 Resuming looking for new tokens...\n");
    return;
  }

  console.log("🔍 Checking Twitter activity...");
  const hasTwitterActivity = await searchTwitterForToken(data.tokenMint);
  
  if (!hasTwitterActivity) {
    console.log("🚫 No Twitter activity found! Transaction aborted.");
    console.log("🟢 Resuming looking for new tokens...\n");
    return;
  }

  // Output logs
  console.log("Token found");
  console.log("👽 GMGN: https://gmgn.ai/sol/token/" + data.tokenMint);
  console.log("😈 BullX: https://neo.bullx.io/terminal?chainId=1399811149&address=" + data.tokenMint);

  // Send token to group if telegram is enabled
  if (config.telegram.enabled) {
    console.log("🔄 Token passed checks, sending to Telegram...");
    await sendTokenToGroup(data.tokenMint);
    console.log("✅ Token address sent to Telegram successfully.");
    console.log("🟢 Resuming looking for new tokens...\n");
  }
}

// Main function to start the WebSocket connection
let init = false;
let activeTransactions = 0;
const MAX_CONCURRENT = 10;

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
      const containsCreate = logs.some((log: string) => 
        typeof log === "string" && log.includes("Program log: initialize2: InitializeInstruction2")
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

    // Initialize browser manager

    // Handle cleanup on process exit
    const cleanup = async () => {
      console.log('\nCleaning up...');
      if (browserManager) {
        await browserManager.close();
      }
      process.exit();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Start WebSocket handler
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
