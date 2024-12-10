import axios from "axios";
import { Connection, Keypair, VersionedTransaction } from "@solana/web3.js";
import { Wallet } from "@project-serum/anchor";
import bs58 from "bs58";
import dotenv from "dotenv";
import { config } from "./config";
import { TransactionDetailsResponseArray, DisplayDataItem, QuoteResponse, SerializedQuoteResponse, RugResponse } from "./types";

// Load environment variables from the .env file
dotenv.config();

export async function fetchTransactionDetails(signature: string): Promise<DisplayDataItem | null> {
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
          timeout: 5000, // Timeout for each request
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

        const instruction = instructions.find((ix) => ix.programId === config.liquidity_pool.radiyum_program_id);

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

    await new Promise((resolve) => setTimeout(resolve, config.tx.get_retry_interval)); // delay
  }

  console.log("Timeout exceeded. No data returned.");
  return null; // Return null after timeout
}

export async function createSwapTransaction(solMint: string, tokenMint: string): Promise<any> {
  const quoteUrl = process.env.JUP_HTTPS_QUOTE_URI || "";
  const swapUrl = process.env.JUP_HTTPS_SWAP_URI || "";
  const rpcUrl = process.env.HELIUS_HTTPS_URI || "";
  const myWallet = new Wallet(Keypair.fromSecretKey(bs58.decode(process.env.PRIV_KEY_WALLET || "")));

  try {
    // Request a quote in order to swap SOL for new token
    const quoteResponse = await axios.get<QuoteResponse>(quoteUrl, {
      params: {
        inputMint: solMint,
        outputMint: tokenMint,
        amount: config.swap.amount,
        slippageBps: config.swap.slippageBps,
      },
      timeout: 5000, // Optional: Set a timeout for the request
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
            maxLamports: 1000000,
            priorityLevel: "veryHigh", // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
          },
        },
      }),
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 5000, // Timeout for each request
      }
    );
    if (!swapTransaction.data) return null;

    // deserialize the transaction
    const swapTransactionBuf = Buffer.from(swapTransaction.data.swapTransaction, "base64");
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

    // Fetch the current status of a transaction signature (processed, confirmed, finalized).
    const conf = await connection.confirmTransaction({
      blockhash: latestBlockHash.blockhash,
      lastValidBlockHeight: latestBlockHash.lastValidBlockHeight,
      signature: txid,
    });

    return `https://solscan.io/tx/${txid}`;
  } catch (error: any) {
    console.error("Error while creating and submitting transaction:", error.message);
    return null;
  }
}

export async function getRugCheckConfirmed(tokenMint: string): Promise<boolean> {
  const rugResponse = await axios.get<RugResponse>("https://api.rugcheck.xyz/v1/tokens/" + tokenMint + "/report/summary", {
    timeout: 5000, // Optional: Set a timeout for the request
  });

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
