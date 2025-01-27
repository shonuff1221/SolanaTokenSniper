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

// Configure body parser for content types
app.use((req, res, next) => {
    const contentType = req.headers['content-type'] || '';
    if (contentType.includes('application/json')) {
        bodyParser.json()(req, res, next);
    } else {
        bodyParser.text({ type: '*/*' })(req, res, next);
    }
});

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
        // Try parsing as JSON first if body is a string that looks like JSON
        if (typeof body === 'string' && body.trim().startsWith('{')) {
            try {
                const jsonData = JSON.parse(body) as WebhookData;
                return {
                    Text: jsonData.Text || '',
                    UserName: jsonData.UserName || '',
                    CreatedAt: jsonData.CreatedAt || new Date().toISOString()
                };
            } catch (error) {
                // Not valid JSON, continue with template parsing
                return error instanceof Error ? error : JSON.parse(body.toString());
            }
        }

        // If body is already an object
        if (typeof body === 'object') {
            const data = body as WebhookData;
            return {
                Text: data.Text || '',
                UserName: data.UserName || '',
                CreatedAt: data.CreatedAt || new Date().toISOString()
            };
        }

        // Parse as text with template tags
        const bodyStr = body.toString();
        console.log('Parsing template tags from:', bodyStr);
        
        const textMatch = bodyStr.match(/{{Text}}(.*?)(?={{|$)/s);
        const userNameMatch = bodyStr.match(/{{UserName}}(.*?)(?={{|$)/s);
        const createdAtMatch = bodyStr.match(/{{CreatedAt}}(.*?)(?={{|$)/s);

        console.log('Matches:', { textMatch, userNameMatch, createdAtMatch });

        return {
            Text: textMatch?.[1]?.trim() || '',
            UserName: userNameMatch?.[1]?.trim() || '',
            CreatedAt: createdAtMatch?.[1]?.trim() || new Date().toISOString()
        };
    } catch (error) {
        console.error('Error parsing webhook body:', error);
        return {
            Text: typeof body === 'string' ? body : JSON.stringify(body),
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
        console.log(`📥 Received webhook data:`, webhookData);

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
