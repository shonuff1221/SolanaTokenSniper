/* eslint-disable @typescript-eslint/no-explicit-any */
import { TelegramClient } from "telegram";
import { StringSession } from "telegram/sessions";
import input from "input";
import dotenv from "dotenv";
import fs from 'fs';
import path from 'path';

dotenv.config();

// We'll use the input package for user prompts

// Save session to .env file
function saveSessionToEnv(session: string) {
    try {
        const envPath = path.join(process.cwd(), '.env');
        if (fs.existsSync(envPath)) {
            let envContent = fs.readFileSync(envPath, 'utf8');
            
            // Check if TELEGRAM_STRING_SESSION already exists
            if (envContent.includes('TELEGRAM_STRING_SESSION=')) {
                // Replace the existing session
                envContent = envContent.replace(
                    /TELEGRAM_STRING_SESSION=["']?.*["']?/,
                    `TELEGRAM_STRING_SESSION="${session}"`
                );
            } else {
                // Add new session
                envContent += `\nTELEGRAM_STRING_SESSION="${session}"\n`;
            }
            
            fs.writeFileSync(envPath, envContent);
            console.log('✅ Session saved to .env file');
        } else {
            console.error('❌ .env file not found');
            console.log('Please manually add this to your .env file:');
            console.log(`TELEGRAM_STRING_SESSION="${session}"`);
        }
    } catch (error) {
        console.error('❌ Error saving session to .env:', error);
        console.log('Please manually add this to your .env file:');
        console.log(`TELEGRAM_STRING_SESSION="${session}"`);
    }
}

async function main() {
    // Validate environment variables
    if (!process.env.TELEGRAM_API_ID || !process.env.TELEGRAM_API_HASH) {
        console.error("❌ Missing Telegram API credentials in .env file");
        console.error("Please ensure you have set TELEGRAM_API_ID and TELEGRAM_API_HASH");
        process.exit(1);
    }

    const apiId = parseInt(process.env.TELEGRAM_API_ID || "0");
    const apiHash = process.env.TELEGRAM_API_HASH || "";
    
    // Create new string session
    const stringSession = new StringSession("");
    
    console.log("🔄 Initializing Telegram client...");
    const client = new TelegramClient(stringSession, apiId, apiHash, {
        connectionRetries: 5,
        useWSS: true,
        deviceModel: "Windows",
        systemVersion: "Windows 10",
        appVersion: "1.0.0",
    });

    try {
        await client.connect();
        console.log("✅ Connected to Telegram");
        
        if (await client.isUserAuthorized()) {
            console.log("✅ Already logged in");
        } else {
            console.log("🔑 Starting login process...");
            
            // Get phone number from user
            const phoneNumber = await input.text("Please enter your phone number (international format): ");
            
            // Start the sign in process
            await client.start({
                phoneNumber: async () => phoneNumber,
                password: async () => await input.text("Please enter your password: "),
                phoneCode: async () => await input.text("Please enter the code you received: "),
                onError: (err) => console.log(err),
            });
            
            console.log("✅ Login successful!");
        }
        
        // Get account info
        const me = await client.getMe();
        if (me && (me as any).username) {
            console.log("✅ Logged in as:", (me as any).username);
        }
        
        // Save session string
        const sessionString = client.session.save();
        console.log("\n✅ Generated session string. Save this to your .env file:");
        console.log(sessionString);
        
        // Save to .env
        if (typeof sessionString === 'string') {
            saveSessionToEnv(sessionString);
        } else {
            console.error("❌ Failed to get session string");
        }
        
    } catch (error: any) {
        console.error("❌ Error:", error.message);
    } finally {
        process.exit(0);
    }
}

main().catch(console.error);
