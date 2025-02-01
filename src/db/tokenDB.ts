import sqlite3 from 'sqlite3';
import { open, Database } from 'sqlite';
import path from 'path';
import fs from 'fs';

let db: Database | null = null;

export interface TokenData {
    mint: string;
    name: string;
    symbol: string;
    initialSolAmount: number;
    marketCapSol: number;
    createdAt: Date;
    lastPrice?: number;
    lastChecked?: Date;
    readyForPriceCheck?: boolean;
}

function getDB(): Database {
    if (!db) {
        throw new Error('Database not initialized. Call initDB() first.');
    }
    return db;
}

export async function initDB(): Promise<void> {
    if (!db) {
        const dbPath = path.join(process.cwd(), 'tokens.db');
        
        // Delete existing database file to ensure clean schema
        try {
            if (fs.existsSync(dbPath)) {
                fs.unlinkSync(dbPath);
                console.log('Removed old database file');
            }
        } catch (error) {
            console.error('Error removing old database:', error);
        }

        db = await open({
            filename: dbPath,
            driver: sqlite3.Database
        });

        // Create tables with current schema
        await db.exec(`
            CREATE TABLE IF NOT EXISTS tokens (
                mint TEXT PRIMARY KEY,
                name TEXT,
                symbol TEXT,
                initialSolAmount REAL,
                marketCapSol REAL,
                createdAt DATETIME,
                lastPrice REAL,
                lastChecked DATETIME,
                readyForPriceCheck BOOLEAN DEFAULT 0
            );

            CREATE INDEX IF NOT EXISTS idx_price_check ON tokens(readyForPriceCheck, lastChecked);
            CREATE INDEX IF NOT EXISTS idx_price ON tokens(lastPrice);
        `);

        console.log('Database initialized with current schema');
    }
}

export async function addToken(token: TokenData): Promise<void> {
    const database = getDB();

    await database.run(
        `INSERT OR IGNORE INTO tokens (
            mint, name, symbol, initialSolAmount, marketCapSol, createdAt, readyForPriceCheck
        ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
        [
            token.mint,
            token.name,
            token.symbol,
            token.initialSolAmount,
            token.marketCapSol,
            token.createdAt.toISOString(),
            false
        ]
    );

    // Schedule token for price checking after 3 seconds
    setTimeout(async () => {
        const db = getDB();
        await db.run(
            `UPDATE tokens SET readyForPriceCheck = 1 WHERE mint = ?`,
            [token.mint]
        );
    }, 3000);
}

export async function updateTokenPrice(mint: string, price: number): Promise<void> {
    const database = getDB();

    await database.run(
        `UPDATE tokens 
         SET lastPrice = ?, lastChecked = ? 
         WHERE mint = ?`,
        [price, new Date().toISOString(), mint]
    );
}

export async function getTokensForPriceCheck(limit: number = 100): Promise<TokenData[]> {
    const database = getDB();

    const tokens = await database.all<TokenData[]>(
        `SELECT * FROM tokens 
         WHERE readyForPriceCheck = 1 
         AND (lastPrice IS NULL OR lastPrice >= 0.003872783)
         ORDER BY lastChecked ASC NULLS FIRST 
         LIMIT ?`,
        [limit]
    );

    return tokens;
}

export async function removeTokensBelowPrice(minPrice: number): Promise<void> {
    const database = getDB();
    const threeSecondsAgo = new Date(Date.now() - 3000);

    await database.run(
        `DELETE FROM tokens 
         WHERE lastPrice < ? 
         AND lastPrice IS NOT NULL 
         AND createdAt < ?`,
        [minPrice, threeSecondsAgo.toISOString()]
    );
}

export async function cleanupOldTokens(daysOld: number): Promise<void> {
    const database = getDB();

    const cutoffDate = new Date();
    cutoffDate.setDate(cutoffDate.getDate() - daysOld);

    await database.run(
        `DELETE FROM tokens 
         WHERE createdAt < ? AND (lastPrice IS NULL OR lastPrice < 0.003872783)`,
        [cutoffDate.toISOString()]
    );
}

export async function getTopTokensByPrice(limit: number = 10): Promise<TokenData[]> {
    const database = getDB();

    const tokens = await database.all<TokenData[]>(
        `SELECT * FROM tokens 
         WHERE lastPrice IS NOT NULL AND lastPrice > 0
         ORDER BY lastPrice DESC 
         LIMIT ?`,
        [limit]
    );

    return tokens;
}

export async function closeDB(): Promise<void> {
    if (db) {
        await db.close();
        db = null;
    }
}
