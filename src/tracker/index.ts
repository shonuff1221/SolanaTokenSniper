import { config } from "./../config"; // Configuration parameters for our bot
import axios from "axios";
import * as sqlite3 from "sqlite3";
import dotenv from "dotenv";
import { open } from "sqlite";
import { createTableHoldings } from "./db";
import { HoldingRecord } from "../types";
import { DateTime } from "luxon";

// Load environment variables from the .env file
dotenv.config();

async function main() {
  const priceUrl = process.env.JUP_HTTPS_PRICE_URI || "";

  // Connect to database and create if not exists
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Create Table if not exists
  const holdingsTableExist = await createTableHoldings(db);
  if (!holdingsTableExist) {
    console.log("Holdings table not present.");
    // Close the database connection when done
    await db.close();
  }

  // Proceed with tracker
  if (holdingsTableExist) {
    // Create a place to store our updated holdings before showing them.
    const holdingLogs: string[] = [];
    const saveLog = (...args: unknown[]): void => {
      const message = args.map((arg) => String(arg)).join(" ");
      holdingLogs.push(message);
    };

    // Get all our current holdings
    const holdings = await db.all("SELECT * FROM holdings");

    // Get all token ids
    const tokenValues = holdings.map((holding) => holding.Token).join(",");

    // Get latest tokens Price
    const solMint = config.liquidity_pool.wsol_pc_mint;
    const priceResponse = await axios.get<any>(priceUrl, {
      params: {
        ids: tokenValues + "," + solMint,
        showExtraInfo: true,
      },
      timeout: config.tx.get_timeout,
    });

    // Verify if we received the latest prices
    const currentPrices = priceResponse.data.data;
    if (!currentPrices) {
      console.log("⛔ Latest price could not be fetched. Trying again...");
      return;
    }

    // Loop trough all our current holdings
    holdings.forEach((row: HoldingRecord) => {
      const token = row.Token;
      const tokenName = row.TokenName === "N/A" ? token : row.TokenName;
      const tokenTime = row.Time;
      const tokenBalance = row.Balance;
      const tokenSolPaid = row.SolPaid;
      const tokenSolFeePaid = row.SolFeePaid;
      const tokenSolPaidUSDC = row.SolPaidUSDC;
      const tokenSolFeePaidUSDC = row.SolFeePaidUSDC;
      const tokenPerTokenPaidUSDC = row.PerTokenPaidUSDC;
      const tokenSlot = row.Slot;
      const tokenProgram = row.Program;

      // Conver Trade Time
      const centralEuropenTime = DateTime.fromMillis(tokenTime).toLocal();
      const hrTradeTime = centralEuropenTime.toFormat("HH:mm:ss");

      // Get current price
      const tokenCurrentPrice = currentPrices[token]?.extraInfo?.lastSwappedPrice?.lastJupiterSellPrice;

      // Calculate PnL and profit/loss
      const unrealizedPnLUSDC = (tokenCurrentPrice - tokenPerTokenPaidUSDC) * tokenBalance - tokenSolFeePaidUSDC;
      const unrealizedPnLPercentage = (unrealizedPnLUSDC / (tokenPerTokenPaidUSDC * tokenBalance)) * 100;
      const iconPnl = unrealizedPnLUSDC > 0 ? "🟢" : "🔴";

      // Check SL/TP
      if (config.sell.auto_sell && config.sell.auto_sell === true) {
        if (unrealizedPnLPercentage >= config.sell.take_profit_percent) {
          // @TODO: SELL
        }
        if (unrealizedPnLPercentage <= -config.sell.stop_loss_percent) {
          // @TODO: SELL
        }
      }

      // Get the current price
      saveLog(
        `${hrTradeTime} Buy ${tokenBalance} ${tokenName} for $${tokenSolPaidUSDC.toFixed(2)}. ${iconPnl} Unrealized PnL: $${unrealizedPnLUSDC.toFixed(
          2
        )} (${unrealizedPnLPercentage.toFixed(2)}%)`
      );
    });

    // Output updated holdings
    console.clear();
    console.log(holdingLogs.join("\n"));
    if (holdings.length === 0) console.log("No token holdings yet as of", new Date().toISOString());

    // Output wallet tracking if set in config
    if (config.sell.track_public_wallet) {
      console.log("\nCheck your wallet: https://gmgn.ai/sol/address/" + config.sell.track_public_wallet);
    }

    // Close the database connection when done
    await db.close();
  }

  setTimeout(main, 5000); // Call main again after 5 seconds
}

main().catch((err) => {
  console.error(err);
});
