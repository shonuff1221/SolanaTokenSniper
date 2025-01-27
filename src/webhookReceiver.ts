import express from 'express';
import bodyParser from 'body-parser';
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

// Configure body parser for text content
app.use(bodyParser.text({ type: 'text/plain' }));
app.use(bodyParser.json({ type: 'application/json' })); // Fallback for JSON

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
function parseWebhookBody(body: string | WebhookData): WebhookData {
    console.log('Received body:', body);
    
    try {
        // Try parsing as JSON first
        if (typeof body === 'object') {
            const data = body as WebhookData;
            return {
                Text: data.Text || '',
                UserName: data.UserName || '',
                CreatedAt: data.CreatedAt || new Date().toISOString()
            };
        }

        // Parse as text with template tags
        const textMatch = body.toString().match(/{{Text}}(.*?)(?={{|$)/s);
        const userNameMatch = body.toString().match(/{{UserName}}(.*?)(?={{|$)/s);
        const createdAtMatch = body.toString().match(/{{CreatedAt}}(.*?)(?={{|$)/s);

        return {
            Text: textMatch?.[1]?.trim() || '',
            UserName: userNameMatch?.[1]?.trim() || '',
            CreatedAt: createdAtMatch?.[1]?.trim() || new Date().toISOString()
        };
    } catch (error) {
        console.error('Error parsing webhook body:', error);
        return {
            Text: body.toString(),
            UserName: 'unknown',
            CreatedAt: new Date().toISOString()
        };
    }
}

// Function to extract token addresses from text
function extractTokenAddresses(text: string): string[] {
    return text.match(config.webhook.token_regex) || [];
}

// Webhook endpoint to receive notifications
app.post(config.webhook.endpoint, async (req, res) => {
    try {
        console.log('Received request with content-type:', req.headers['content-type']);
        
        // Parse the webhook body
        const webhookData = parseWebhookBody(req.body);
        console.log(`📥 Received webhook from @${webhookData.UserName}`);
        console.log(`💬 Tweet: ${webhookData.Text}`);

        // Extract token addresses from the tweet text
        const tokenAddresses = extractTokenAddresses(webhookData.Text);

        // If token addresses found, process them
        if (tokenAddresses.length > 0) {
            for (const tokenAddress of tokenAddresses) {
                console.log(`💎 Found token address: ${tokenAddress}`);
                
                // Check if we've seen this token before
                if (isTokenFound(tokenAddress)) {
                    console.log(`⏭️ Token ${tokenAddress} already processed, skipping...`);
                    continue;
                }

                try {
                    await sendTokenToGroup(tokenAddress);
                    console.log(`✅ Sent token ${tokenAddress} to Telegram`);
                    
                    // Save the token as processed
                    saveFoundToken(tokenAddress, webhookData);
                } catch (error) {
                    console.error(`❌ Error sending token ${tokenAddress} to Telegram:`, 
                        error instanceof Error ? error.message : error);
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
