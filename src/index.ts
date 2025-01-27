// import WebSocket from "ws"; // Node.js websocket library
// import { WebSocketRequest } from "./types"; // Typescript Types for type safety
// import { config } from "./config"; // Configuration parameters for our bot
// import { fetchTransactionDetails, searchTwitterForToken } from "./TwitterPoolScan";
// import { validateEnv } from "./utils/env-validator";
// import { initTelegram, sendTokenToGroup } from "./telegram";

// // Define types


// // Regional Variables
// let activeTransactions = 0;
// const MAX_CONCURRENT = config.tx.concurrent_transactions;

// // Function used to open our websocket connection
// function sendSubscribeRequest(ws: WebSocket): void {
//   const request: WebSocketRequest = {
//     jsonrpc: "2.0",
//     id: 1,
//     method: "logsSubscribe",
//     params: [
//       {
//         mentions: [config.liquidity_pool.radiyum_program_id],
//       },
//       {
//         commitment: "processed", // Can use finalized to be more accurate.
//         encoding: "jsonParsed",
//       },
//     ],
//   };
//   ws.send(JSON.stringify(request));
// }

// // Function used to handle the transaction once a new pool creation is found
// async function processTransaction(signature: string): Promise<void> {
//   // Output logs
//   console.log("=============================================");
//   console.log(" New Liquidity Pool found.");
//   console.log(" Fetching transaction details ...");

//   // Fetch the transaction details
//   const data = await fetchTransactionDetails(signature);
//   if (!data) {
//     console.log("❌ Failed to fetch transaction details");
//     return;
//   }

//   console.log("🔍 Checking Twitter activity...");
//   const hasTwitterActivity = await searchTwitterForToken(data.tokenMint);
  
//   if (!hasTwitterActivity) {
//     console.log("❌ Token failed Twitter activity check");
//     return;
//   }

//   console.log("✅ Token passed all checks!");


//   // Check if token is from pump.fun
//   if (data.tokenMint.trim().toLowerCase().endsWith("pump") && config.rug_check.ignore_pump_fun) {
//     console.log(" Transaction skipped. Ignoring Pump.fun.");
//     console.log("✅ Resuming looking for new tokens..\n");
//     return;
//   }

//   // Ouput logs
//   console.log("✅ Token found");
//   console.log(" GMGN: https://gmgn.ai/sol/token/" + data.tokenMint);
//   console.log(" BullX: https://neo.bullx.io/terminal?chainId=1399811149&address=" + data.tokenMint);

//   // Check if simulation mode is enabled
//   if (config.rug_check.simulation_mode) {
//     console.log("✅ Token not sent to group. Simulation mode is enabled.");
//     console.log("✅ Resuming looking for new tokens..\n");
//     return;
//   }

//   try {
//     // If token found and Telegram is enabled, send to group
//     if (config.telegram.enabled) {
//       console.log("🔄 Token passed rug check, sending to Telegram...");
//       await sendTokenToGroup(data.tokenMint);
//       console.log("✅ Token address sent to Telegram successfully.");
//     }
//   } catch (error) {
//     console.error("❌ Error sending to Telegram:", error);
//     console.error("Full error:", error);
//   }
// }

// // Websocket Handler for listening to the Solana logSubscribe method
// let init = false;
// async function websocketHandler(): Promise<void> {
//   // Load environment variables from the .env file
//   const env = validateEnv();

//   // Create a WebSocket connection
//   let ws: WebSocket | null = new WebSocket(env.HELIUS_WSS_URI);
//   if (!init) console.clear();

//   // @TODO, test with hosting our app on a Cloud instance closer to the RPC nodes physical location for minimal latency
//   // @TODO, test with different RPC and API nodes (free and paid) from quicknode and shyft to test speed

//   // Send subscription to the websocket once the connection is open
//   ws.on("open", () => {
//     // Subscribe
//     if (ws) sendSubscribeRequest(ws); // Send a request once the WebSocket is open
//     console.log("\n🔓 WebSocket is open and listening.");
//     init = true;
//   });

//   // Logic for the message event for the .on event listener
//   ws.on("message", async (data: WebSocket.Data) => {
//     try {
//       const message = JSON.parse(data.toString());
      
//       // Log the raw message for debugging
//       console.log("\nReceived WebSocket message:");
//       console.log(JSON.stringify(message, null, 2));

//       // Check if it's an account notification
//       if (message.params?.result?.value?.account?.data) {
//         const signature = message.params.result.value.signature;
//         console.log("\n=============================================");
//         console.log(" New Liquidity Pool found.");
//         console.log(` Transaction Signature: ${signature}`);

//         // Verify if we have reached the max concurrent transactions
//         if (activeTransactions >= MAX_CONCURRENT) {
//           console.log(" Max concurrent transactions reached, skipping...");
//           return;
//         }

//         // Add additional concurrent transaction
//         activeTransactions++;

//         // Process transaction asynchronously
//         processTransaction(signature)
//           .catch((error) => {
//             console.error("Error processing transaction:", error);
//           })
//           .finally(() => {
//             activeTransactions--;
//           });
//       }
//     } catch (error) {
//       console.error(" Error processing message:", {
//         error: error instanceof Error ? error.message : "Unknown error",
//         timestamp: new Date().toISOString(),
//       });
//     }
//   });

//   ws.on("error", (err: Error) => {
//     console.error("WebSocket error:", err);
//     ws = null;
//   });

//   ws.on("close", () => {
//     console.log(" WebSocket connection closed, cleaning up...");
//     if (ws) {
//       ws.removeAllListeners();
//       ws = null;
//     }
//     console.log(" Attempting to reconnect in 5 seconds...");
//     setTimeout(websocketHandler, 5000);
//   });
// }

// // Main function
// async function main(): Promise<void> {
//   try {
//     // Validate environment variables
//     validateEnv();

//     // Initialize Telegram if enabled
//     if (config.telegram.enabled) {
//       await initTelegram();
//     }

//     // Start WebSocket handler
//     await websocketHandler();
//   } catch (error) {
//     console.error("Error starting application:", error);
//     process.exit(1);
//   }
// }

// // Start the application
// main();
