import WebSocket from "ws"; // Node.js websocket library
import { WebSocketRequest } from "./types"; // Typescript Types for type safety
import { config } from "./config"; // Configuration parameters for our bot
import { fetchTransactionDetails, getRugCheckConfirmed } from "./transactions";
import { validateEnv } from "./utils/env-validator";
import { initTelegram, sendTokenToGroup } from "./telegram";

// Define types
interface TransactionData {
  tokenMint: string;
  solMint: string;
}

// Regional Variables
let activeTransactions = 0;
const MAX_CONCURRENT = config.tx.concurrent_transactions;

// Function used to open our websocket connection
function sendSubscribeRequest(ws: WebSocket): void {
  const request: WebSocketRequest = {
    jsonrpc: "2.0",
    id: 1,
    method: "logsSubscribe",
    params: [
      {
        mentions: [config.liquidity_pool.radiyum_program_id],
      },
      {
        commitment: "processed", // Can use finalized to be more accurate.
      },
    ],
  };
  ws.send(JSON.stringify(request));
}

// Function used to handle the transaction once a new pool creation is found
async function processTransaction(signature: string): Promise<void> {
  // Output logs
  console.log("=============================================");
  console.log(" New Liquidity Pool found.");
  console.log(" Fetching transaction details ...");

  // Fetch the transaction details
  const transactionData = await fetchTransactionDetails(signature);

  if (!transactionData || !transactionData.tokenMint || !transactionData.solMint) {
    console.log(" Transaction aborted. No data returned or missing required fields.");
    console.log("✅ Resuming looking for new tokens...\n");
    return;
  }

  const data: TransactionData = {
    tokenMint: transactionData.tokenMint,
    solMint: transactionData.solMint
  };

  // Check rug check
  const isRugCheckPassed = await getRugCheckConfirmed(data.tokenMint);
  if (!isRugCheckPassed) {
    console.log(" Rug Check not passed! Transaction aborted.");
    console.log("✅ Resuming looking for new tokens...\n");
    return;
  }

  // Check if token is from pump.fun
  if (data.tokenMint.trim().toLowerCase().endsWith("pump") && config.rug_check.ignore_pump_fun) {
    console.log(" Transaction skipped. Ignoring Pump.fun.");
    console.log("✅ Resuming looking for new tokens..\n");
    return;
  }

  // Ouput logs
  console.log("✅ Token found");
  console.log(" GMGN: https://gmgn.ai/sol/token/" + data.tokenMint);
  console.log(" BullX: https://neo.bullx.io/terminal?chainId=1399811149&address=" + data.tokenMint);

  // Check if simulation mode is enabled
  if (config.rug_check.simulation_mode) {
    console.log("✅ Token not sent to group. Simulation mode is enabled.");
    console.log("✅ Resuming looking for new tokens..\n");
    return;
  }

  try {
    // If token found and Telegram is enabled, send to group
    if (config.telegram.enabled && config.telegram.group_id) {
      await sendTokenToGroup(data.tokenMint, config.telegram.group_id);
      console.log("✅ Token address sent to Telegram group successfully.");
    }
  } catch (error) {
    console.error("❌ Error processing transaction:", error);
  }
}

// Websocket Handler for listening to the Solana logSubscribe method
let init = false;
async function websocketHandler(): Promise<void> {
  // Load environment variables from the .env file
  const env = validateEnv();

  // Create a WebSocket connection
  let ws: WebSocket | null = new WebSocket(env.HELIUS_WSS_URI);
  if (!init) console.clear();

  // @TODO, test with hosting our app on a Cloud instance closer to the RPC nodes physical location for minimal latency
  // @TODO, test with different RPC and API nodes (free and paid) from quicknode and shyft to test speed

  // Send subscription to the websocket once the connection is open
  ws.on("open", () => {
    // Subscribe
    if (ws) sendSubscribeRequest(ws); // Send a request once the WebSocket is open
    console.log("\n🔓 WebSocket is open and listening.");
    init = true;
  });

  // Logic for the message event for the .on event listener
  ws.on("message", async (data: WebSocket.Data) => {
    try {
      const jsonString = data.toString(); // Convert data to a string
      const parsedData = JSON.parse(jsonString); // Parse the JSON string

      // Handle subscription response
      if (parsedData.result !== undefined && !parsedData.error) {
        console.log("✅ Subscription confirmed");
        return;
      }

      // Only log RPC errors for debugging
      if (parsedData.error) {
        console.error(" RPC Error:", parsedData.error);
        return;
      }

      // Safely access the nested structure
      const logs = parsedData?.params?.result?.value?.logs;
      const signature = parsedData?.params?.result?.value?.signature;

      // Validate `logs` is an array and if we have a signtature
      if (!Array.isArray(logs) || !signature) return;

      // Verify if this is a new pool creation
      const containsCreate = logs.some((log: string) => typeof log === "string" && log.includes("Program log: initialize2: InitializeInstruction2"));
      if (!containsCreate || typeof signature !== "string") return;

      // Verify if we have reached the max concurrent transactions
      if (activeTransactions >= MAX_CONCURRENT) {
        console.log(" Max concurrent transactions reached, skipping...");
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
      console.error(" Error processing message:", {
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  ws.on("error", (err: Error) => {
    console.error("WebSocket error:", err);
    ws = null;
  });

  ws.on("close", () => {
    console.log(" WebSocket connection closed, cleaning up...");
    if (ws) {
      ws.removeAllListeners();
      ws = null;
    }
    console.log(" Attempting to reconnect in 5 seconds...");
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

    // Start WebSocket handler
    await websocketHandler();
  } catch (error) {
    console.error("Error starting application:", error);
    process.exit(1);
  }
}

// Start the application
main();
