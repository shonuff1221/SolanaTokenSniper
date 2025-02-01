/* eslint-disable @typescript-eslint/no-explicit-any */
import axios from 'axios';
import dotenv from "dotenv";

dotenv.config();

const botToken = process.env.TELEGRAM_BOT_TOKEN || "";

export async function initTelegram() {
    if (!process.env.TELEGRAM_BOT_TOKEN) {
        console.error("❌ Missing TELEGRAM_BOT_TOKEN in .env file");
        console.error("Please ensure you have set TELEGRAM_BOT_TOKEN");
        process.exit(1);
    }
    
    try {
        // Test the bot token by getting bot info
        const response = await axios.get(`https://api.telegram.org/bot${botToken}/getMe`);
        console.log("✅ Telegram bot initialized successfully:", response.data.result.username);
    } catch (error) {
        console.error("❌ Failed to initialize Telegram bot:", error);
        process.exit(1);
    }
}

export async function sendMessage(chatId: string | number, message: string) {
    try {
        const response = await axios.post(`https://api.telegram.org/bot${botToken}/sendMessage`, {
            chat_id: chatId,
            text: message,
            parse_mode: 'HTML'
        });
        return response.data;
    } catch (error: any) {
        console.error("❌ Failed to send message:", error.response?.data || error.message);
        throw error;
    }
}

export async function sendTokenToGroup(tokenAddress: string, tweetText?: string, author?: string) {
    try {
        const groupId = process.env.TELEGRAM_GROUP_ID;
        if (!groupId) {
            throw new Error("TELEGRAM_GROUP_ID not set in environment variables");
        }

        const message = `🚨 New Alert Found! 🚨\n` +
    `⏰ Time: ${new Date().toLocaleString('en-US', { timeZone: 'America/New_York' })}\n\n` +
    `${tweetText ? `📝 Tweet: "${tweetText}"\n` : ''}` +
    `${author ? `👤 Author: @${author}\n\n` : '\n'}` +
    `Token Address: <code>${tokenAddress}</code>\n\n` +
    `💱 View on Bullx_NEO:\n` +
    `https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenAddress}\n\n` +    
    `🤖 Trade with Bots:\n` +
    `• Nova Bot - https://t.me/TradeonNovaBot?start=r-shonuff\n` +
    `• Trojan Achilles - https://t.me/achilles_trojanbot?start=r-shonuff1221\n` +
    `• ZelfiGuru - https://t.me/zelfiguru_on_solana_bot?start=NTEyODk3MTc2\n` +
    `• TradeWiz - https://t.me/TradeWiz_Solbot?start=r-AKW2IOTDSX\n\n` +
    `🎯 Called by: Shonuff Solana Alerts\n` +
    `💎 Join us: https://t.me/Shonuff_Solana_Alerts`;

        await sendMessage(groupId, message);
        console.log("✅ Token info sent to Telegram group successfully");
    } catch (error: any) {
        console.error("❌ Failed to send token to group:", error.message);
        throw error;
    }
}
