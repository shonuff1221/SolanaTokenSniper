import { getTopTokensByPrice } from './db/tokenDB';
import { clearLine, cursorTo } from 'readline';

let isDisplaying = false;

function clearLines(count: number): void {
    for (let i = 0; i < count; i++) {
        clearLine(process.stdout, 0);
        cursorTo(process.stdout, 0);
        if (i < count - 1) {
            process.stdout.moveCursor(0, -1);
        }
    }
}

function formatPrice(price: number): string {
    if (price >= 1) {
        return price.toFixed(2);
    } else if (price >= 0.0001) {
        return price.toFixed(6);
    } else {
        return price.toExponential(4);
    }
}

function formatTimeDiff(date: Date): string {
    const diff = Math.floor((Date.now() - date.getTime()) / 1000);
    if (diff < 60) return `${diff}s ago`;
    if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
    return `${Math.floor(diff / 3600)}h ago`;
}

export async function displayTopTokens(): Promise<void> {
    if (isDisplaying) return;
    isDisplaying = true;

    try {
        const tokens = await getTopTokensByPrice(10);
        
        // Clear previous output (header + 10 tokens + empty line)
        clearLines(12);

        // Display header
        console.log('\n🏆 Top 10 Tokens by Price:');
        console.log('═══════════════════════════════════════════════════════════════════════════');
        
        // Display tokens
        tokens.forEach((token, index) => {
            const lastChecked = token.lastChecked ? formatTimeDiff(new Date(token.lastChecked)) : 'never';
            const price = token.lastPrice || 0;
            const marketCap = token.marketCapSol;
            
            console.log(
                `${(index + 1).toString().padStart(2)}. ` +
                `${token.symbol.padEnd(10)} ` +
                `$${formatPrice(price).padEnd(14)} ` +
                `MC: ${marketCap.toFixed(2)} SOL `.padEnd(20) +
                `Age: ${formatTimeDiff(new Date(token.createdAt))} ` +
                `Updated: ${lastChecked}`
            );
        });

        if (tokens.length === 0) {
            console.log('No tokens found yet...');
        }

        console.log('═══════════════════════════════════════════════════════════════════════════');
    } catch (error) {
        if (error instanceof Error) {
            console.error('Error displaying tokens:', error.message);
        }
    } finally {
        isDisplaying = false;
    }
}

export async function startDisplay(): Promise<void> {
    // Update display every second
    setInterval(async () => {
        await displayTopTokens();
    }, 1000);
}
