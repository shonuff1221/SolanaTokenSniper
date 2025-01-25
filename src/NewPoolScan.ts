/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";
import dotenv from "dotenv";
import { config } from "./config";
import {
  TransactionDetailsResponseArray,
  MintsDataResponse,
} from "./types";
import { BrowserManager } from './testBrowser';
import * as path from 'path';
import * as fs from 'fs';

// Load environment variables from the .env file
dotenv.config();

// Create a singleton browser manager
let browserManager: BrowserManager | null = null;

async function getBrowserManager(): Promise<BrowserManager> {
  if (!browserManager) {
    browserManager = new BrowserManager();
    await browserManager.initialize();
  }
  return browserManager;
}

export async function fetchTransactionDetails(signature: string): Promise<MintsDataResponse | null> {
  // Set function constants
  const txUrl = process.env.HELIUS_HTTPS_URI_TX || "";
  
  if (!txUrl) {
    console.error("❌ HELIUS_HTTPS_URI_TX is not set in .env file");
    return null;
  }

  console.log("\nHelius API URL:", txUrl);
  console.log("Fetching details for signature:", signature);
  
  const maxRetries = config.tx.fetch_tx_max_retries;
  let retryCount = 0;

  // Add longer initial delay to allow transaction to be processed
  const initialDelay = config.tx.fetch_tx_initial_delay;
  console.log(`Waiting ${initialDelay/1000} seconds for transaction to be confirmed...`);
  await new Promise((resolve) => setTimeout(resolve, initialDelay));

  while (retryCount < maxRetries) {
    try {
      console.log(`\nAttempt ${retryCount + 1} of ${maxRetries} to fetch transaction details...`);
      
      const requestBody = {
        transactions: [signature],
        commitment: "confirmed",
        encoding: "jsonParsed",
      };
      
      console.log("Request to Helius API:", JSON.stringify(requestBody, null, 2));

      const response = await axios.post<any>(
        txUrl,
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      console.log("\nHelius API Response:", JSON.stringify(response.data, null, 2));

      // Verify if a response was received
      if (!response.data) {
        throw new Error("No response data received");
      }

      // Verify if the response was in the correct format and not empty
      if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new Error("Response data array is empty");
      }

      // Access the `data` property which contains the array of transactions
      const transactions: TransactionDetailsResponseArray = response.data;

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

      // Output logs
      console.log("\n✅ Successfully fetched transaction details!");
      console.log(`SOL Token Account: ${solTokenAccount}`);
      console.log(`New Token Account: ${newTokenAccount}`);

      const displayData: MintsDataResponse = {
        tokenMint: newTokenAccount,
        solMint: solTokenAccount,
      };

      return displayData;
    } catch (error: any) {
      console.log(`❌ Attempt ${retryCount + 1} failed: ${error.message}`);
      if (error.response) {
        console.log("Error response from Helius:", error.response.data);
      }

      retryCount++;

      if (retryCount < maxRetries) {
        const delay = Math.min(4000 * Math.pow(1.5, retryCount), 20000);
        console.log(`Waiting ${delay / 1000} seconds before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.log("❌ All attempts to fetch transaction details failed");
  return null;
}

export async function searchTwitterForToken(tokenMint: string): Promise<boolean> {
  try {
    const manager = await getBrowserManager();
    
    console.log(`🔍 Searching Twitter for token: ${tokenMint}`);
    await manager.searchToken(tokenMint);
    
    // Get the saved tweets from the most recent file
    const dataDir = path.join(process.cwd(), 'data');
    const files = fs.readdirSync(dataDir)
      .filter(file => file.startsWith(`tweets-${tokenMint}`))
      .sort()
      .reverse();
    
    if (files.length === 0) {
      console.log('❌ No Twitter activity found for this token');
      return false;
    }
    
    const latestFile = path.join(dataDir, files[0]);
    const tweetData = JSON.parse(fs.readFileSync(latestFile, 'utf8'));
    
    // Analysis criteria
    const minimumTweets = config.twitter_search?.minimum_tweets || 2;
    const minimumUniqueAuthors = config.twitter_search?.minimum_unique_authors || 2;
    const maximumTweetAge = config.twitter_search?.maximum_tweet_age_minutes || 10;
    
    // Analyze tweets
    if (tweetData.tweets.length < minimumTweets) {
      console.log(`❌ Not enough tweets (found: ${tweetData.tweets.length}, required: ${minimumTweets})`);
      return false;
    }
    
    const uniqueAuthors = new Set(tweetData.tweets.map((t: { author: any; }) => t.author));
    if (uniqueAuthors.size < minimumUniqueAuthors) {
      console.log(`❌ Not enough unique authors (found: ${uniqueAuthors.size}, required: ${minimumUniqueAuthors})`);
      return false;
    }
    
    // Check tweet age
    const now = new Date();
    const oldestAllowedTime = new Date(now.getTime() - (maximumTweetAge * 60 * 1000));
    
    const recentTweets = tweetData.tweets.filter((tweet: { timestamp: string | number | Date; }) => {
      const tweetTime = new Date(tweet.timestamp);
      return tweetTime > oldestAllowedTime;
    });
    
    if (recentTweets.length < minimumTweets) {
      console.log(`❌ Not enough recent tweets in the last ${maximumTweetAge} minutes`);
      return false;
    }
    
    // If we get here, the token has passed our Twitter activity checks
    console.log('✅ Token has sufficient Twitter activity!');
    console.log(`Found ${recentTweets.length} recent tweets from ${uniqueAuthors.size} unique authors`);
    
    // Display some tweet info
    recentTweets.forEach((tweet: { author: any; timestamp: string | number | Date; text: string | any[]; }, index: number) => {
      console.log(`\nTweet ${index + 1}:`);
      console.log(`Author: @${tweet.author}`);
      console.log(`Time: ${new Date(tweet.timestamp).toLocaleString()}`);
      console.log(`Content: ${tweet.text.slice(0, 100)}...`);
    });
    
    return true;
    
  } catch (error: any) {
    console.error("Error during Twitter search:", error.message);
    return false;
  }
}

// Update the config type to include Twitter search settings
declare module "./config" {
  interface Config {
    twitter_search?: {
      minimum_tweets: number;
      minimum_unique_authors: number;
      maximum_tweet_age_minutes: number;
    };
  }
}