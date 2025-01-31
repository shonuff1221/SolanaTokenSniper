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
const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || "");

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

    if (!process.env.TELEGRAM_STRING_SESSION) {
        console.error("❌ Missing TELEGRAM_STRING_SESSION in .env file");
        console.error("Please run the local setup first to generate a session");
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

        // Hardcoded username
        const targetUsername = "TradeonNova3Bot";  //nova bot
        //const targetUsername = "TradeonNova3Bot";  //nova bot
        //const targetUsername = "achilles_trojanbot";  //trojan bot
        //const targetUsername = "dEdge_solana_bot";  //dEdge bot       

        // Format the message with token links
        const message = `🚨 New Token Found! 🚨\n\n` +
            `Token: \`${tokenAddress}\`\n\n` +
            `🔍 View on:\n` +
            `• [GMGN](https://gmgn.ai/sol/token/${tokenAddress})\n` +
            `• [BullX](https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenAddress})\n` +
            `• [Solscan](https://solscan.io/token/${tokenAddress})\n\n` +
            '@Shonuff - Token Sniper\n\n' +
            '```\n' +
            `${tokenAddress}\n` +
            '```\n';

        // If username is provided, send to that user
        const peer = await findUserByUsername(targetUsername);
        await client.sendMessage(peer, {
            message,
            parseMode: 'markdown',
            linkPreview: false
        });
        console.log(`✅ Token sent to user @${targetUsername} successfully`);
    } catch (error) {
        console.error("❌ Error sending token to group:", error);
        throw error;
    }
}
