import { BrowserManager } from './testBrowser';
import readline from 'readline';

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

async function main() {
    const manager = new BrowserManager();
    await manager.initialize();

    console.log('\nBrowser initialized. Enter token addresses to search (one per line).');
    console.log('The browser will automatically close after 3 minutes of inactivity.');
    console.log('Press Ctrl+C to exit.\n');

    rl.on('line', async (input) => {
        if (input.trim()) {
            try {
                await manager.searchToken(input.trim());
                console.log('\nEnter another token address to search, or wait for auto-close:');
            } catch (error) {
                console.error('Error searching token:', error);
            }
        }
    });

    rl.on('close', () => {
        manager.close().catch(console.error);
        process.exit(0);
    });
}

main().catch(console.error);
