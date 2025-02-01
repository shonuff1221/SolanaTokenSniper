import axios from 'axios';
import { getTokensForPriceCheck, updateTokenPrice, removeTokensBelowPrice, cleanupOldTokens } from './db/tokenDB';

const BATCH_SIZE = 100;
const MIN_PRICE = 0.000003872783;
const CLEANUP_DAYS = 1;

interface JupiterPriceResponse {
    data: {
        [key: string]: {
            id: string;
            mintSymbol: string;
            vsToken: string;
            vsTokenSymbol: string;
            price: number;
        }
    }
}

export async function checkPrices(): Promise<void> {
    try {
        // Get tokens that need price checking
        const tokens = await getTokensForPriceCheck(BATCH_SIZE);
        if (tokens.length === 0) {
            return;
        }

        // Filter out tokens that are less than 3 seconds old
        const threeSecondsAgo = new Date(Date.now() - 3000);
        const readyTokens = tokens.filter(token => new Date(token.createdAt) < threeSecondsAgo);

        if (readyTokens.length === 0) {
            return;
        }

        // Create comma-separated list of token mints
        const tokenIds = readyTokens.map(t => t.mint).join(',');

        // Get prices from Jupiter
        const response = await axios.get<JupiterPriceResponse>(
            `https://api.jup.ag/price/v2?ids=${tokenIds}`
        );

        // Update prices in database
        for (const token of readyTokens) {
            const priceData = response.data.data[token.mint];
            const price = priceData ? priceData.price : 0;
            
            if (price > 0) {
                const timeSinceCreation = Math.floor((Date.now() - new Date(token.createdAt).getTime()) / 1000);
                if (price < MIN_PRICE) {
                    console.log(`❌ [${timeSinceCreation}s] Removing ${token.symbol} (${token.mint}) - Price too low: $${price}`);
                } else {
                    console.log(`💰 [${timeSinceCreation}s] ${token.symbol} (${token.mint}) - Price: $${price}`);
                }
            }
            
            await updateTokenPrice(token.mint, price);
        }

        // Remove tokens below minimum price (database function now handles the 3-second check)
        await removeTokensBelowPrice(MIN_PRICE);

        // Cleanup old tokens periodically
        await cleanupOldTokens(CLEANUP_DAYS);

    } catch (error) {
        if (error instanceof Error) {
            console.error('Error checking prices:', error.message);
        } else {
            console.error('Unknown error checking prices');
        }
    }
}

export async function startPriceChecker(): Promise<void> {
    console.log('🔄 Starting price checker...');
    
    // Run price check every second
    setInterval(async () => {
        await checkPrices();
    }, 1000);
}
