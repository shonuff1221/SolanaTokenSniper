import WebSocket from "ws"; // Node.js websocket library
import dotenv from "dotenv"; // zero-dependency module that loads environment variables from a .env
import { WebSocketRequest } from "./types"; // Typescript Types for type safety
import { config } from "./config"; // Configuration parameters for our bot
import { fetchTransactionDetails, createSwapTransaction, getRugCheckConfirmed } from "./transactions";

// Load environment variables from the .env file
dotenv.config();

// Function used to open our websocket connection
function sendRequest(ws: WebSocket): void {
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

async function websocketHandler(): Promise<void> {
  // Create a WebSocket connection
  let ws: WebSocket | null = new WebSocket(process.env.HELIUS_WSS_URI || "");
  let transactionOngoing = false;

  // Send subscription to the websocket once the connection is open
  ws.on("open", () => {
    if (ws) sendRequest(ws); // Send a request once the WebSocket is open
    console.log("🔓 WebSocket is open and listening.");
  });

  // Logic for the message event for the .on event listener
  ws.on("message", async (data: WebSocket.Data) => {
    try {
      const jsonString = data.toString(); // Convert data to a string
      const parsedData = JSON.parse(jsonString); // Parse the JSON string

      // Safely access the nested structure
      const logs = parsedData?.params?.result?.value?.logs;
      const signature = parsedData?.params?.result?.value?.signature;

      // Validate `logs` is an array
      if (Array.isArray(logs)) {
        const containsCreate = logs.some((log: string) => typeof log === "string" && log.includes("Program log: initialize2: InitializeInstruction2"));

        if (!containsCreate || typeof signature !== "string") return;

        // Stop the websocket from listening and restarting
        transactionOngoing = true;
        if (ws) ws.close(1000, "Handing transactions.");

        // Output logs
        console.log("==========================================");
        console.log("🔎 New Liquidity Pool found.");
        console.log("🔐 Pause Websocket to handle transaction.");

        // Fetch the transaction details
        console.log("🔃 Fetching transaction details ...");
        const data = await fetchTransactionDetails(signature);

        // Abort and restart socket
        if (!data) {
          console.log("⛔ Transaction aborted. No transaction data returned.");
          console.log("==========================================");
          return websocketHandler();
        }

        // Ensure required data is available
        if (!data.solMint || !data.tokenMint) return;

        // Check rug check
        const isRugCheckPassed = await getRugCheckConfirmed(data.tokenMint);
        if (!isRugCheckPassed) {
          console.log("🚫 Rug Check not passed! Transaction aborted.");
          console.log("==========================================");
          return websocketHandler();
        }

        // Handle ignored tokens
        if (data.tokenMint.trim().toLowerCase().endsWith("pump") && config.liquidity_pool.ignore_pump_fun) {
          // Check if ignored
          console.log("🚫 Transaction skipped. Ignoring Pump.fun.");
          console.log("==========================================");
          return websocketHandler();
        }

        console.log("💰 Token found: https://gmgn.ai/sol/token/" + data.tokenMint);
        const tx = await createSwapTransaction(data.solMint, data.tokenMint);

        // Abort and restart socket
        if (!tx) {
          console.log("⛔Transaction aborted. No valid swap quote received.");
          return websocketHandler();
        }

        if (tx) {
          console.log("✅ Swap quote recieved.");
          console.log("🚀 Swapping SOL for Token.");
          console.log("Swap Transaction: ", tx);
          console.log("==========================================");
          //Start Websocket to listen for new tokens
          return websocketHandler();
        }
      }
    } catch (error) {
      console.error("Error parsing JSON or processing data:", error);
    }
  });

  ws.on("error", (err: Error) => {
    console.error("WebSocket error:", err);
  });

  ws.on("close", () => {
    // Connection closed, discard old websocket and create a new one in 5 seconds
    ws = null;
    if (!transactionOngoing) {
      console.log("WebSocket is closed. Restarting in 5 seconds...");
      setTimeout(websocketHandler, 5000);
    }
  });
}

websocketHandler();
