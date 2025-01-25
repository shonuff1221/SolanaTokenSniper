/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from "axios";

import dotenv from "dotenv";
import { config } from "./config";
import {
  TransactionDetailsResponseArray,
  MintsDataResponse,
  RugResponseExtended,
} from "./types";

// Load environment variables from the .env file
dotenv.config();

export async function fetchTransactionDetails(signature: string): Promise<MintsDataResponse | null> {
  // Set function constants
  const txUrl = process.env.HELIUS_HTTPS_URI_TX || "";
  const maxRetries = config.tx.fetch_tx_max_retries;
  let retryCount = 0;

  // Add longer initial delay to allow transaction to be processed
  console.log("Waiting " + config.tx.fetch_tx_initial_delay / 1000 + " seconds for transaction to be confirmed...");
  await new Promise((resolve) => setTimeout(resolve, config.tx.fetch_tx_initial_delay));

  while (retryCount < maxRetries) {
    try {
      // Output logs
      console.log(`Attempt ${retryCount + 1} of ${maxRetries} to fetch transaction details...`);

      const response = await axios.post<any>(
        txUrl,
        {
          transactions: [signature],
          commitment: "finalized",
          encoding: "jsonParsed",
        },
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: config.tx.get_timeout,
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
      console.log("Successfully fetched transaction details!");
      console.log(`SOL Token Account: ${solTokenAccount}`);
      console.log(`New Token Account: ${newTokenAccount}`);

      const displayData: MintsDataResponse = {
        tokenMint: newTokenAccount,
        solMint: solTokenAccount,
      };

      return displayData;
    } catch (error: any) {
      console.log(`Attempt ${retryCount + 1} failed: ${error.message}`);

      retryCount++;

      if (retryCount < maxRetries) {
        const delay = Math.min(2000 * Math.pow(1.5, retryCount), 15000);
        console.log(`Waiting ${delay / 1000} seconds before next attempt...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.log("All attempts to fetch transaction details failed");
  return null;
}

export async function getRugCheckConfirmed(tokenMint: string): Promise<boolean> {
  try {
    const rugResponse = await axios.get<RugResponseExtended>("https://api.rugcheck.xyz/v1/tokens/" + tokenMint + "/report", {
      timeout: config.tx.get_timeout,
    });

    if (!rugResponse.data) return false;

    if (config.rug_check.verbose_log && config.rug_check.verbose_log === true) {
      console.log(rugResponse.data);
    }

    // Extract information
    const tokenReport: RugResponseExtended = rugResponse.data;
    // const tokenCreator = tokenReport.creator ? tokenReport.creator : tokenMint;
    const mintAuthority = tokenReport.token.mintAuthority;
    const freezeAuthority = tokenReport.token.freezeAuthority;
    const isInitialized = tokenReport.token.isInitialized;
    const tokenName = tokenReport.tokenMeta.name;
    const tokenSymbol = tokenReport.tokenMeta.symbol;
    const tokenMutable = tokenReport.tokenMeta.mutable;
    let topHolders = tokenReport.topHolders;
    const marketsLength = tokenReport.markets ? tokenReport.markets.length : 0;
    const totalLPProviders = tokenReport.totalLPProviders;
    const totalMarketLiquidity = tokenReport.totalMarketLiquidity;
    const isRugged = tokenReport.rugged;
    const rugScore = tokenReport.score;
    const createdAt = new Date(tokenReport.detectedAt);
    const tokenAgeMinutes = Math.round((Date.now() - createdAt.getTime()) / (1000 * 60));

    if (config.rug_check.verbose_log) {
      console.log("Token age:", tokenAgeMinutes, "minutes");
      console.log("Created at:", createdAt.toISOString());
    }

    const rugRisks = tokenReport.risks
      ? tokenReport.risks
      : [
          {
            name: "Good",
            value: "",
            description: "",
            score: 0,
            level: "good",
          },
        ];

    // Update topholders if liquidity pools are excluded
    if (config.rug_check.exclude_lp_from_topholders) {
      // local types
      type Market = {
        liquidityA?: string;
        liquidityB?: string;
      };

      const markets: Market[] | undefined = tokenReport.markets;
      if (markets) {
        // Safely extract liquidity addresses from markets
        const liquidityAddresses: string[] = (markets ?? [])
          .flatMap((market) => [market.liquidityA, market.liquidityB])
          .filter((address): address is string => !!address);

        // Filter out topHolders that match any of the liquidity addresses
        topHolders = topHolders.filter((holder) => !liquidityAddresses.includes(holder.address));
      }
    }

    // Get config
    const rugCheckConfig = config.rug_check;
    const rugCheckLegacy = rugCheckConfig.legacy_not_allowed;

    // Set conditions
    const conditions = [
      {
        check: !rugCheckConfig.allow_mint_authority && mintAuthority !== null,
        message: "🚫 Mint authority should be null",
      },
      {
        check: !rugCheckConfig.allow_not_initialized && !isInitialized,
        message: "🚫 Token is not initialized",
      },
      {
        check: !rugCheckConfig.allow_freeze_authority && freezeAuthority !== null,
        message: "🚫 Freeze authority should be null",
      },
      {
        check: !rugCheckConfig.allow_mutable && tokenMutable !== false,
        message: "🚫 Mutable should be false",
      },
      {
        check: !rugCheckConfig.allow_insider_topholders && topHolders.some((holder) => holder.insider),
        message: "🚫 Insider accounts should not be part of the top holders",
      },
      {
        check: topHolders.some((holder) => holder.pct > rugCheckConfig.max_alowed_pct_topholders),
        message: () => {
          const maxHolder = topHolders.reduce((max, holder) => holder.pct > max.pct ? holder : max);
          return `🚫[${maxHolder.pct.toFixed(1)}%] An individual top holder cannot hold more than ${rugCheckConfig.max_alowed_pct_topholders}% of the total supply`;
        },
      },
      {
        check: totalLPProviders < rugCheckConfig.min_total_lp_providers,
        message: `🚫[${totalLPProviders}] Not enough LP Providers (min: ${rugCheckConfig.min_total_lp_providers})`,
      },
      {
        check: marketsLength < rugCheckConfig.min_total_markets,
        message: `🚫[${marketsLength}] Not enough Markets (min: ${rugCheckConfig.min_total_markets})`,
      },
      {
        check: totalMarketLiquidity < rugCheckConfig.min_total_market_Liquidity,
        message: `🚫[$${Math.round(totalMarketLiquidity)}] Not enough Market Liquidity (min: $${rugCheckConfig.min_total_market_Liquidity})`,
      },
      {
        check: !rugCheckConfig.allow_rugged && isRugged,
        message: "🚫 Token is rugged",
      },
      {
        check: rugCheckConfig.block_symbols.includes(tokenSymbol),
        message: "🚫 Symbol is blocked",
      },
      {
        check: rugCheckConfig.block_names.includes(tokenName),
        message: "🚫 Name is blocked",
      },
      {
        check: rugScore > rugCheckConfig.max_score && rugCheckConfig.max_score !== 0,
        message: `🚫[${rugScore}] Rug score too high (max: ${rugCheckConfig.max_score})`,
      },
      {
        check: rugRisks.some((risk) => rugCheckLegacy.includes(risk.name)),
        message: "🚫 Token has legacy risks that are not allowed",
      },
      {
        check: rugCheckConfig.max_token_age_minutes > 0 && tokenAgeMinutes > rugCheckConfig.max_token_age_minutes,
        message: `🚫[${tokenAgeMinutes}min] Token is too old (max: ${rugCheckConfig.max_token_age_minutes}min)`,
      },
    ];

    //Validate conditions
    for (const condition of conditions) {
      if (condition.check) {
        const message = typeof condition.message === 'function' ? condition.message() : condition.message;
        console.log(message);
        return false;
      }
    }

    // If the token passes all checks, send it to the group
    console.log("✅ Token passed rug check!");
    try {
      // Replace this with your actual implementation to send to the group
      console.log(`🚀Sending token address ${tokenMint} to the group`);
      // Add your group notification logic here
      return true;
    } catch (error) {
      console.error("Failed to send token address to group:", error);
      return false;
    }

  } catch (error: any) {
    console.error("Error during rugcheck:", error.message);
    return false;
  }
}