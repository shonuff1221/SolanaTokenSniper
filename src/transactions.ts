import axios from "axios";
import fs from "fs";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { Wallet } from "@project-serum/anchor";
import bs58 from "bs58";
import dotenv from "dotenv";
import { config } from "./config";
import {
  TransactionDetailsResponseArray,
  DisplayDataItem,
  QuoteResponse,
  SerializedQuoteResponse,
  RugResponse,
  SwapEventDetailsResponse,
} from "./types";

// Load environment variables from the .env file
dotenv.config();

export async function fetchTransactionDetails(
  signature: string
): Promise<DisplayDataItem | null> {
  const API_URL = process.env.HELIUS_HTTPS_URI_TX || "";
  const startTime = Date.now();

  while (Date.now() - startTime < config.tx.get_retry_timeout) {
    try {
      const response = await axios.post<any>(
        API_URL,
        { transactions: [signature] },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000, // Timeout for each request
        }
      );

      if (response.data && response.data.length > 0) {
        // Access the `data` property which contains the array of transactions
        const transactions: TransactionDetailsResponseArray = response.data;

        // Safely access the first transaction's instructions
        const instructions = transactions[0]?.instructions;

        if (!instructions || instructions.length === 0) {
          console.log("no instructions found. Skipping LP.");
          return null;
        }

        const instruction = instructions.find(
          (ix) => ix.programId === config.liquidity_pool.radiyum_program_id
        );

        if (!instruction || !instruction.accounts) {
          console.log("no instruction found. Skipping LP.");
          return null;
        }

        // Set new token and SOL mint
        const accounts = instruction.accounts;
        const accountOne = accounts[8];
        const accountTwo = accounts[9];
        let solTokenAccount = "";
        let newTokenAccount = "";
        if (accountOne === config.liquidity_pool.wsol_pc_mint) {
          solTokenAccount = accountOne;
          newTokenAccount = accountTwo;
        } else {
          solTokenAccount = accountTwo;
          newTokenAccount = accountOne;
        }

        const displayData: DisplayDataItem = {
          tokenMint: newTokenAccount,
          solMint: solTokenAccount,
        };

        return displayData;
      }
    } catch (error: any) {
      console.error("Error during request:", error.message);
      return null;
    }

    await new Promise((resolve) =>
      setTimeout(resolve, config.tx.get_retry_interval)
    ); // delay
  }

  console.log("Timeout exceeded. No data returned.");
  return null; // Return null after timeout
}

export async function createSwapTransaction(
  solMint: string,
  tokenMint: string
): Promise<string | null> {
  const quoteUrl = process.env.JUP_HTTPS_QUOTE_URI || "";
  const swapUrl = process.env.JUP_HTTPS_SWAP_URI || "";
  const rpcUrl = process.env.HELIUS_HTTPS_URI || "";
  const myWallet = new Wallet(
    Keypair.fromSecretKey(bs58.decode(process.env.PRIV_KEY_WALLET || ""))
  );

  try {
    // Request a quote in order to swap SOL for new token
    const quoteResponse = await axios.get<QuoteResponse>(quoteUrl, {
      params: {
        inputMint: solMint,
        outputMint: tokenMint,
        amount: config.swap.amount,
        slippageBps: config.swap.slippageBps,
      },
      timeout: config.tx.get_timeout,
    });

    if (!quoteResponse.data) return null;

    // Serialize the quote into a swap transaction that can be submitted on chain
    const swapTransaction = await axios.post<SerializedQuoteResponse>(
      swapUrl,
      JSON.stringify({
        // quoteResponse from /quote api
        quoteResponse: quoteResponse.data,
        // user public key to be used for the swap
        userPublicKey: myWallet.publicKey.toString(),
        // auto wrap and unwrap SOL. default is true
        wrapAndUnwrapSol: true,
        //dynamicComputeUnitLimit: true, // allow dynamic compute limit instead of max 1,400,000
        dynamicSlippage: {
          // This will set an optimized slippage to ensure high success rate
          maxBps: 300, // Make sure to set a reasonable cap here to prevent MEV
        },
        prioritizationFeeLamports: {
          priorityLevelWithMaxLamports: {
            maxLamports: config.swap.prio_fee_max_lamports,
            priorityLevel: config.swap.prio_level,
          },
        },
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: config.tx.get_timeout,
      }
    );
    if (!swapTransaction.data) return null;

    if (swapTransaction.data) console.log("swaptx received.");

    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(
      swapTransaction.data.swapTransaction,
      "base64"
    );
    var transaction = VersionedTransaction.deserialize(swapTransactionBuf);

    // sign the transaction
    transaction.sign([myWallet.payer]);

    // get the latest block hash
    const connection = new Connection(rpcUrl);
    const latestBlockHash = await connection.getLatestBlockhash();

    // Execute the transaction
    const rawTransaction = transaction.serialize();
    const txid = await connection.sendRawTransaction(rawTransaction, {
      skipPreflight: true, // If True, This will skip transaction simulation entirely.
      maxRetries: 2,
    });

    // Return null when no tx was returned
    if (!txid) {
      return null;
    }

    // Fetch the current status of a transaction signature (processed, confirmed, finalized).
    const conf = await connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: txid,
    });

    // Return null when an error occured when confirming the transaction
    if (conf.value.err || conf.value.err !== null) {
      return null;
    }

    return txid;
  } catch (error: any) {
    console.error(
      "Error while creating and submitting transaction:",
      error.message
    );
    return null;
  }
}

export async function getRugCheckConfirmed(
  tokenMint: string
): Promise<boolean> {
  const rugResponse = await axios.get<RugResponse>(
    "https://api.rugcheck.xyz/v1/tokens/" + tokenMint + "/report/summary",
    {
      timeout: 5000, // Optional: Set a timeout for the request
    }
  );

  if (!rugResponse.data) return false;

  // Check if a single user holds more than 30 %
  for (const risk of rugResponse.data.risks) {
    if (risk.name === "Single holder ownership") {
      const numericValue = parseFloat(risk.value.replace("%", "")); // Convert percentage string to a number
      if (numericValue > config.rug_check.single_holder_ownership) {
        return false; // Return false immediately if value exceeds 30%
      }
    }
  }

  // Check for valid liquidity and if not copy cat token.
  function isRiskAcceptable(tokenDetails: RugResponse): boolean {
    const notAllowed = config.rug_check.not_allowed;
    return !tokenDetails.risks.some((risk) => notAllowed.includes(risk.name));
  }

  return isRiskAcceptable(rugResponse.data);
}

export async function fetchAndSaveSwapDetails(tx: string): Promise<boolean> {
  const API_URL = process.env.HELIUS_HTTPS_URI_TX || "";

  try {
    const response = await axios.post<any>(
      API_URL,
      { transactions: [tx] },
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 10000, // Timeout for each request
      }
    );

    // Verify if we received reponse data
    if (!response.data || response.data.length === 0) {
      console.log(
        "⛔ Could not fetch swap details: No response received from API."
      );
      return false;
    }

    // Safely access the event information
    const transactions: TransactionDetailsResponseArray = response.data;

    const txSwapTokenInputs =
      transactions[0]?.events.swap.innerSwaps[0].tokenInputs;
    const txSwapTokenOutputs =
      transactions[0]?.events.swap.innerSwaps[0].tokenOutputs;
    const txSwapProgram =
      transactions[0]?.events.swap.innerSwaps[0].programInfo;

    const eventTokenFee = transactions[0]?.fee;
    const eventTokenSlot = transactions[0]?.slot;
    const eventTokenTimestamp = transactions[0]?.timestamp;
    const eventDescription = transactions[0]?.description;

    const swapTransactionData: SwapEventDetailsResponse = {
      programInfo: txSwapProgram,
      tokenInputs: txSwapTokenInputs,
      tokenOutputs: txSwapTokenOutputs,
      fee: eventTokenFee,
      slot: eventTokenSlot,
      timestamp: eventTokenTimestamp,
      description: eventDescription,
    };

    // Save transaction in tracker csv
    if (!fs.existsSync(config.swap.file_name_tracker_holdings)) {
      fs.writeFileSync(
        config.swap.file_name_tracker_holdings,
        "Time,TokenMint,AmountTokenReceived,AmountSolPaid,AmountSolFeePaid,Slot,Program\n"
      );
    }

    // Log the order in the CSV file
    fs.appendFileSync(
      config.swap.file_name_tracker_holdings,
      `${swapTransactionData.timestamp},${swapTransactionData.tokenOutputs[0].mint},${swapTransactionData.tokenOutputs[0].tokenAmount},${swapTransactionData.tokenInputs[0].tokenAmount},${swapTransactionData.fee},${swapTransactionData.slot},${swapTransactionData.programInfo.source}\n`
    );

    return true;
  } catch (error: any) {
    console.error("Error during request:", error.message);
    return false;
  }
}
