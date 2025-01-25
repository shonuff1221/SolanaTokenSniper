/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";

import dotenv from "dotenv";
import { config } from "./config";
import {
  TransactionDetailsResponseArray,
  MintsDataResponse,
} from "./types";

// Load environment variables from the .env file
dotenv.config();

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