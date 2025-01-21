/* eslint-disable @typescript-eslint/no-explicit-any */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import input from "input";
import dotenv from "dotenv";
import fs from 'fs';
import path from 'path';
import bigInt from "big-integer";

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
const apiHash = process.env.TELEGRAM_API_HASH || "";
const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || "");

let client: TelegramClient | null = null;

function saveSessionToFile(session: string) {
    try {
        // Save to a text file
        const sessionFilePath = path.join(process.cwd(), 'telegram_session.txt');
        fs.writeFileSync(sessionFilePath, session);
        console.log(`✅ Session saved to: ${sessionFilePath}`);

        // Try to append to .env file if it exists
        const envPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
            const envContent = fs.readFileSync(envPath, 'utf8');
            if (!envContent.includes('TELEGRAM_STRING_SESSION=')) {
                fs.appendFileSync(envPath, `\nTELEGRAM_STRING_SESSION=${session}`);
                console.log('✅ Session also appended to .env file');
            }
        }
    } catch (error) {
        console.error('❌ Error saving session:', error);
        console.log('Please manually save this session string:');
        console.log(session);
    }
}

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

        await client.start({
            phoneNumber: async () => await input.text("Please enter your phone number: "),
            password: async () => await input.text("Please enter your password: "),
            phoneCode: async () => await input.text("Please enter the code you received: "),
            onError: (err) => console.log(err),
        });

        console.log("✅ Connected to Telegram");
        if (!process.env.TELEGRAM_STRING_SESSION) {
            console.log("\n=== TELEGRAM SESSION INFO ===");
            const session = client.session as StringSession;
            const sessionString = session.save();
            saveSessionToFile(sessionString);
            console.log("===============================\n");
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
        
        console.log("❌ User not found");
        return null;
    } catch (error) {
        console.error("Failed to find user:", error);
        return null;
    }
}

async function sendMessage(username: string, message: string) {
    try {
        // First try to find the user
        const peer = await findUserByUsername(username);
        if (!peer) {
            throw new Error("Could not find user. Make sure the username is correct.");
        }

        console.log("Sending message to user:", username);
        
        await client?.invoke(new Api.messages.SendMessage({
            peer: peer,
            message: message,
            randomId: bigInt(Math.floor(Math.random() * 1000000000))
        }));
        
        return true;
    } catch (error: any) {
        console.error("Failed to send message:", error);
        throw error;
    }
}

export async function sendTokenToGroup(tokenAddress: string) {
    console.log("🔄 Attempting to send message to Telegram chat...");
    
    if (!client) {
        console.error("❌ Telegram client not initialized. Call initTelegram first.");
        return false;
    }

    try {
        const username = process.env.TELEGRAM_USERNAME;
        if (!username) {
            console.error("❌ No username configured");
            return false;
        }
        
        console.log("📝 Sending to username:", username);

        // Format the message with relevant links
        const message = `🚨 New Token Found 🚨\n\n` +
            `Token Address: ${tokenAddress}\n\n` +
            `🔍 View on:\n` +
            `GMGN: https://gmgn.ai/sol/token/${tokenAddress}\n` +
            `BullX: https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenAddress}\n\n` +
            `✅ Passed Rugcheck`;

        await sendMessage(username, message);

        console.log('✅ Token address sent to Telegram chat');
        return true;

    } catch (error: any) {
        console.error('❌ Failed to send message to Telegram:', error.message);
        console.error('🔍 Debug info:');
        console.error('- Client connected:', !!client);
        console.error('- Full error:', error);
        
        if (error.message.includes('PEER_ID_INVALID')) {
            console.error('❌ Username is invalid. Please ensure:');
            console.error('1. The username exists');
            console.error('2. The username is spelled correctly');
            console.error('3. You have permission to send messages to this user');
        }
        return false;
    }
}
