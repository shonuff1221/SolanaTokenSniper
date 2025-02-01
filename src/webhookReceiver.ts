import express, {  Router, RequestHandler } from 'express';
import { config } from './config';
import { initTelegram, sendTokenToGroup } from './telegram';
import { validateEnv } from "./utils/env-validator";
import dotenv from "dotenv";
import fs from 'fs';
import path from 'path';


// Load environment variables
dotenv.config();

// Initialize environment variables
validateEnv();

const app = express();
const router = Router();

// Configure express to accept raw body
app.use(express.raw({ type: '*/*' }));

interface WebhookData {
    Text: string;
    UserName: string;
    CreatedAt: string;
}

interface TokensConfig {
    tokens: {
        [key: string]: {
            firstSeenAt: string;
            tweetUrl: string;
            author: string;
        };
    };
}

// interface RugResponseExtended {
//     token: {
//         mintAuthority: string;
//         freezeAuthority: string;
//         isInitialized: boolean;
//     };
//     tokenMeta: {
//         name: string;
//         symbol: string;
//         mutable: boolean;
//     };
//     detectedAt: string;
//     topHolders: Array<{
//         address: string;
//         amount: number;
//         share: number;
//     }>;
//     markets: Array<{
//         address: string;
//         liquidity: number;
//         lpProviders: number;
//     }>;
//     totalLPProviders: number;
//     totalMarketLiquidity: number;
//     rugged: boolean;
//     score: number;
//     risks?: Array<{
//         name: string;
//         value: string;
//         description: string;
//         score: number;
//         level: string;
//     }>;
// }

// Function to check if token has been found before
function isTokenFound(tokenAddress: string): boolean {
    try {
        const configPath = path.join(__dirname, 'config', 'found_tokens.json');
        if (!fs.existsSync(configPath)) {
            return false;
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as TokensConfig;
        return !!config.tokens[tokenAddress];
    } catch (error) {
        console.error('❌ Error checking token status:', error);
        return false;
    }
}

// Function to save found token
function saveFoundToken(tokenAddress: string, webhookData: WebhookData): void {
    try {
        const configPath = path.join(__dirname, 'config', 'found_tokens.json');
        let config: TokensConfig = { tokens: {} };
        
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as TokensConfig;
        }

        if (!config.tokens[tokenAddress]) {
            config.tokens[tokenAddress] = {
                firstSeenAt: new Date().toISOString(),
                tweetUrl: webhookData.Text, // Store the tweet text as we don't have the URL
                author: webhookData.UserName
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
            console.log('✅ Saved new token to found_tokens.json:', tokenAddress);
        }
    } catch (error) {
        console.error('❌ Error saving found token:', error);
    }
}

// Function to parse webhook body
function parseWebhookBody(body: Buffer): WebhookData {
    try {
        // Convert buffer to string
        const bodyStr = body.toString('utf-8');
        console.log('Parsing webhook body:', bodyStr);

        // Extract token address
        const caMatch = bodyStr.match(/CA:\s*([A-Za-z0-9]{32,})/);
        const token = caMatch ? caMatch[1] : null;

        // Extract username (usually a single word on its own line)
        const lines = bodyStr.split('\n');
        const username = lines.find(line => /^[a-zA-Z0-9_]+$/.test(line.trim()))?.trim() || 'unknown';

        // Extract date (usually the last line)
        const dateLine = lines[lines.length - 1]?.trim() || new Date().toISOString();

        if (token) {
            console.log('Found token:', token);
            console.log('Found username:', username);
            console.log('Found date:', dateLine);
            
            return {
                Text: bodyStr, // Keep full text for token extraction
                UserName: username,
                CreatedAt: dateLine
            };
        }

        console.log('No token found in message');
        return {
            Text: '',
            UserName: username,
            CreatedAt: dateLine
        };
    } catch (error) {
        console.error('Error parsing webhook body:', error);
        return {
            Text: '',
            UserName: 'unknown',
            CreatedAt: new Date().toISOString()
        };
    }
}

// Function to extract token addresses from text
function extractTokenAddresses(text: string): string[] {
    const matches = text.match(config.webhook.token_regex) || [];
    return [...new Set(matches)]; // Remove duplicates
}

// Webhook endpoint to receive notifications
const webhookHandler: RequestHandler = async (req, res) => {
    try {
        console.log('Received request with content-type:', req.headers['content-type']);
        const webhookData = parseWebhookBody(req.body);
        console.log('📥 Received webhook data:', webhookData);

        // Extract token addresses from the tweet text
        const tokenAddresses = extractTokenAddresses(webhookData.Text);
        console.log('🔍 Found token addresses:', tokenAddresses);

        if (tokenAddresses.length === 0) {
            console.log('❌ No token addresses found in tweet');
            res.status(200).send('No token addresses found');
            return;
        }

        for (const tokenAddress of tokenAddresses) {
            // Check if we've already found this token
            if (isTokenFound(tokenAddress)) {
                console.log(`⏭️ Token ${tokenAddress} already processed, skipping`);
                continue;
            }

            try {
                // Save the token as found
                saveFoundToken(tokenAddress, webhookData);
                console.log(`✅ Saved token ${tokenAddress} as found`);

                // Send to Telegram with tweet info
                await sendTokenToGroup(tokenAddress, webhookData.Text, webhookData.UserName);
                console.log(`✅ Sent token ${tokenAddress} to Telegram`);
            } catch (error) {
                console.error(`❌ Error processing token ${tokenAddress}:`, error);
            }
        }

        res.status(200).send('Webhook processed successfully');
    } catch (error) {
        console.error('❌ Error processing webhook:', error);
        res.status(500).send('Error processing webhook');
    }
};

router.post(config.webhook.endpoint, webhookHandler);

app.use('/', router);

// Start the server
async function main() {
    if (!config.webhook.enabled) {
        console.log('⚠️ Webhook receiver is disabled in config');
        process.exit(0);
    }

    try {
        // Ensure config directory exists
        const configDir = path.join(__dirname, 'config');
        if (!fs.existsSync(configDir)) {
            fs.mkdirSync(configDir, { recursive: true });
        }

        // Initialize Telegram
        console.log('🔄 Initializing Telegram...');
        await initTelegram();
        console.log('✅ Telegram initialized');

        // Start the server
        app.listen(config.webhook.port, () => {
            console.log(`🚀 Webhook receiver listening on port ${config.webhook.port}`);
            console.log(`📝 Webhook URL: http://localhost:${config.webhook.port}${config.webhook.endpoint}`);
            console.log('Ready to receive webhooks and forward tokens to Telegram! 🚀');
        });
    } catch (error: unknown) {
        console.error('❌ Error starting server:', error instanceof Error ? error.message : error);
        process.exit(1);
    }
}

// Run the server
main().catch((error: unknown) => {
    console.error('❌ Fatal error:', error instanceof Error ? error.message : error);
    process.exit(1);
});
