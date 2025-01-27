import express from 'express';
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
    // First try to extract from CA: format
    const caMatch = text.match(/CA:\s*([A-Za-z0-9]{32,})/);
    if (caMatch && caMatch[1]) {
        console.log('Extracted token from CA format:', caMatch[1]);
        return [caMatch[1]];
    }
    
    // Fallback to regex from config
    const configMatches = text.match(config.webhook.token_regex) || [];
    if (configMatches.length > 0) {
        console.log('Extracted tokens from config regex:', configMatches);
    }
    return configMatches;
}

// Webhook endpoint to receive notifications
app.post(config.webhook.endpoint, async (req, res) => {
    try {
        console.log('Received request with content-type:', req.headers['content-type']);
        
        // Parse the webhook body
        const webhookData = parseWebhookBody(req.body);
        console.log(`📥 Received webhook data:`, webhookData);

        // Extract token addresses from the tweet text
        const tokenAddresses = extractTokenAddresses(webhookData.Text);

        // If token addresses found, process them
        if (tokenAddresses.length > 0) {
            for (const tokenAddress of tokenAddresses) {
                // Skip if token has been found before
                if (isTokenFound(tokenAddress)) {
                    console.log(`⏭️ Token ${tokenAddress} has been found before, skipping...`);
                    continue;
                }

                console.log(`🔍 Processing token: ${tokenAddress}`);
                
                // Save token to found_tokens.json
                saveFoundToken(tokenAddress, webhookData);

                // Send token to Telegram if enabled
                if (config.telegram.enabled) {
                    try {
                        await sendTokenToGroup(tokenAddress);
                        console.log(`✅ Sent token ${tokenAddress} to Telegram`);
                    } catch (error) {
                        console.error(`❌ Error sending token ${tokenAddress} to Telegram:`, error);
                    }
                }
            }
        }

        res.status(200).json({ status: 'success' });
    } catch (error: unknown) {
        console.error('❌ Error processing webhook:', error);
        res.status(500).json({ 
            status: 'error', 
            message: error instanceof Error ? error.message : 'Unknown error occurred'
        });
    }
});

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
