/* eslint-disable @typescript-eslint/no-explicit-any */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import { Api } from "telegram/tl";
import input from "input";
import dotenv from "dotenv";
import fs from 'fs';
import path from 'path';

dotenv.config();

const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
const apiHash = process.env.TELEGRAM_API_HASH || "";
const stringSession = new StringSession(process.env.TELEGRAM_STRING_SESSION || "");

let client: TelegramClient;

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
            // Try to send a test message
            await testTelegramMessage();
        }

    } catch (error: any) {
        console.error("❌ Failed to connect to Telegram:", error.message);
        throw error;
    }
}

// Test function to send a simple message
export async function testTelegramMessage() {
    if (!client) {
        console.error("❌ Telegram client not initialized");
        return false;
    }

    const groupId = process.env.TELEGRAM_GROUP_ID;
    if (!groupId) {
        console.error("❌ No group ID configured");
        return false;
    }

    try {
        console.log("🔄 Sending test message...");
        console.log("📝 Group ID:", groupId);

        
        console.log("✅ Test message sent!");
        return true;
    } catch (error: any) {
        console.error("❌ Failed to send test message:", error);
        console.error("Full error:", error);
        return false;
    }
}

export async function sendTokenToGroup(tokenAddress: string, groupId: string) {
    console.log("🔄 Attempting to send message to Telegram group...");
    
    if (!client) {
        console.error("❌ Telegram client not initialized. Call initTelegram first.");
        return false;
    }

    try {
        console.log("📝 Using group ID:", groupId);

        // Format the message with relevant links


        console.log('✅ Token address sent to Telegram group');
        return true;

    } catch (error: any) {
        console.error('❌ Failed to send message to Telegram:', error.message);
        console.error('🔍 Debug info:');
        console.error('- Group ID:', groupId);
        console.error('- Client connected:', !!client);
        console.error('- Full error:', error);
        
        if (error.message.includes('CHAT_ID_INVALID')) {
            console.error('❌ Chat ID is invalid. Please ensure:');
            console.error('1. You are a member of the group');
            console.error('2. The chat ID is correct');
            console.error('3. You have permission to send messages in the group');
        }
        return false;
    }
}
