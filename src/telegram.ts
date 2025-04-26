/* eslint-disable @typescript-eslint/no-explicit-any */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import dotenv from "dotenv";
// import fs from 'fs';
// import path from 'path';
// import bigInt from "big-integer";

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
const apiHash = process.env.TELEGRAM_API_HASH || "";

// Create a custom session class that can work with both Telegram.js and Pyrogram session strings
class CustomSession extends StringSession {
    constructor(session: string) {
        // If empty, create an empty session
        if (!session) {
            super("");
            return;
        }

        try {
            // Try to use it as a regular Telegram.js session first
            super(session);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        } catch (_) {
            // If it fails, it might be a Pyrogram session string
            // For now, we'll create an empty session
            console.log("The provided session string is not in Telegram.js format");
            console.log("Starting with a new session");
            super("");
        }
    }
}

// Get the session string from environment variables
const sessionStr = process.env.TELEGRAM_STRING_SESSION || "";
// Create a custom session that can handle both formats
const stringSession = new CustomSession(sessionStr);

let client: TelegramClient | null = null;

//NOT NEEDED WITH DOCKER
// function saveSessionToFile(session: string) {
//     try {
//         // Save to a text file
//         const sessionFilePath = path.join(process.cwd(), 'telegram_session.txt');
//         fs.writeFileSync(sessionFilePath, session);
//         console.log(`✅ Session saved to: ${sessionFilePath}`);

//         // Try to append to .env file if it exists
//         const envPath = path.join(process.cwd(), '.env');
//         if (fs.existsSync(envPath)) {
//             const envContent = fs.readFileSync(envPath, 'utf8');
//             if (!envContent.includes('TELEGRAM_STRING_SESSION=')) {
//                 fs.appendFileSync(envPath, `\nTELEGRAM_STRING_SESSION=${session}`);
//                 console.log('✅ Session also appended to .env file');
//             }
//         }
//     } catch (error) {
//         console.error('❌ Error saving session:', error);
//         console.log('Please manually save this session string:');
//         console.log(session);
//     }
// }

export async function initTelegram() {
    // Validate environment variables
    if (!process.env.TELEGRAM_API_ID || !process.env.TELEGRAM_API_HASH) {
        console.error("❌ Missing Telegram API credentials in .env file");
        console.error("Please ensure you have set TELEGRAM_API_ID and TELEGRAM_API_HASH");
        process.exit(1);
    }

    try {
        console.log("🔄 Initializing Telegram client...");
        client = new TelegramClient(stringSession, apiId, apiHash, {
            connectionRetries: 5,
            useWSS: true,
            deviceModel: "Windows",
            systemVersion: "Windows 10",
            appVersion: "1.0.0",
        });

        await client.connect();
        console.log("✅ Connected to Telegram");

        // Check if we're logged in
        if (!await client.isUserAuthorized()) {
            console.log("⚠️ Not logged in. Starting login process...");
            
            // For automated systems, you would need to use a bot token
            // or have a way to input the verification code
            console.error("❌ Automated login not possible in this script.");
            console.error("Please run a separate script to generate a valid session string.");
            process.exit(1);
        }

        // Test connection by getting self
        const me = await client.getMe();
        if (me && (me as Api.User).username) {
            console.log("✅ Logged in as:", (me as Api.User).username);            
        }

    } catch (error: any) {
        console.error("❌ Failed to connect to Telegram:", error.message);
        throw error;
    }
}

async function findUserByUsername(username: string): Promise<any> {
    try {
        console.log("🔍 Looking for user:", username);
        // Remove @ if present
        const cleanUsername = username.replace('@', '');
        
        const result = await client?.invoke(new Api.contacts.ResolveUsername({
            username: cleanUsername
        }));
        
        if (result && result.peer) {
            console.log("✅ Found user!");
            return result.peer;
        }
        
        throw new Error("User not found");
    } catch (error) {
        console.error("❌ Error finding user:", error);
        throw error;
    }
}

export async function sendMessage(username: string, message: string) {
    try {
        if (!client) {
            throw new Error("Telegram client not initialized");
        }

        const peer = await findUserByUsername(username);
        await client.sendMessage(peer, { message });
        console.log("✅ Message sent successfully");
    } catch (error) {
        console.error("❌ Error sending message:", error);
        throw error;
    }
}

export async function sendTokenToGroup(tokenAddress: string) {
    try {
        if (!client) {
            throw new Error("Telegram client not initialized");
        }

        if (!process.env.TELEGRAM_GROUP_ID) {
            throw new Error("TELEGRAM_GROUP_ID not set in environment variables");
        }

        const groupId = process.env.TELEGRAM_GROUP_ID;
        
        // Format the message with token links
        const message = `🚨 New Token Found! 🚨\n\n` +
            `Token: \`${tokenAddress}\`\n\n` +
            `🔍 View on:\n` +
            `• [GMGN](https://gmgn.ai/sol/token/${tokenAddress})\n` +
            `• [BullX](https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenAddress})\n` +
            `• [Solscan](https://solscan.io/token/${tokenAddress})\n\n` +
            `⚡️ Trade on:\n` +
            `• [Raydium](https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${tokenAddress})\n` +
            `• [Jupiter](https://jup.ag/swap/SOL-${tokenAddress})`;

        await client.sendMessage(groupId, {
            message,
            parseMode: 'markdown',
            linkPreview: false
        });

        console.log("✅ Token sent to group successfully");
    } catch (error) {
        console.error("❌ Error sending token to group:", error);
        throw error;
    }
}
