import * as sqlite3 from "sqlite3";
import { open } from "sqlite";
import { config } from "./../config";
import { HoldingRecord } from "../types";

export async function createTableHoldings(database: any): Promise<boolean> {
  try {
    await database.exec(`
    CREATE TABLE IF NOT EXISTS holdings (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      Time INTEGER NOT NULL,
      Token TEXT NOT NULL,
      TokenName TEXT NOT NULL,
      Balance REAL NOT NULL,
      SolPaid REAL NOT NULL,
      SolFeePaid REAL NOT NULL,
      SolPaidUSDC REAL NOT NULL,
      SolFeePaidUSDC REAL NOT NULL,
      PerTokenPaidUSDC REAL NOT NULL,
      Slot INTEGER NOT NULL,
      Program TEXT NOT NULL
    );
  `);
    return true;
  } catch (error: any) {
    return false;
  }
}

export async function insertHolding(holding: HoldingRecord) {
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Create Table if not exists
  const holdingsTableExist = await createTableHoldings(db);
  if (!holdingsTableExist) {
    await db.close();
  }

  // Proceed with adding holding
  if (holdingsTableExist) {
    const { Time, Token, TokenName, Balance, SolPaid, SolFeePaid, SolPaidUSDC, SolFeePaidUSDC, PerTokenPaidUSDC, Slot, Program } = holding;
    await db.run(
      `
    INSERT INTO holdings (Time, Token, TokenName, Balance, SolPaid, SolFeePaid, SolPaidUSDC, SolFeePaidUSDC, PerTokenPaidUSDC, Slot, Program)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?);
  `,
      [Time, Token, TokenName, Balance, SolPaid, SolFeePaid, SolPaidUSDC, SolFeePaidUSDC, PerTokenPaidUSDC, Slot, Program]
    );

    await db.close();
  }
}

export async function removeHolding(tokenMint: string) {
  const db = await open({
    filename: config.swap.db_name_tracker_holdings,
    driver: sqlite3.Database,
  });

  // Proceed with deleting the holding
  await db.run(
    `
    DELETE FROM holdings
    WHERE Token = ?;
    `,
    [tokenMint]
  );

  await db.close();
}
