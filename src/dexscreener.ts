import WebSocket from "ws";
import axios from "axios";
import dotenv from "dotenv";
import { config } from "./config";
import { validateEnv } from "./utils/env-validator";
import { initTelegram } from "./telegram";
import path from 'path';
import fs from 'fs';

// Load environment variables
dotenv.config();

// Initialize environment variables
validateEnv();

// Initialize Telegram (if enabled)
if (config.telegram.enabled) {
  initTelegram();
}

// Types
interface WebSocketRequest {
  jsonrpc: "2.0";
  id: string;
  method: string;
  params: unknown[];
}

// Constants for DexScreener API
const SOLANA_CHAIN_ID = 'solana';

// Types for DexScreener API responses
interface DexScreenerOrder {
  id: string;
  chainId: string;
  dexId: string;
  pairAddress: string;
  baseToken: {
    address: string;
    name: string;
    symbol: string;
  };
  quoteToken: {
    address: string;
    name: string;
    symbol: string;
  };
  priceUsd: string;
  priceNative: string;
  txHash: string;
  createdAt: string;
  type: 'buy' | 'sell';
  amountInUsd: string;
  from: string;
}

interface DexScreenerOrdersResponse {
  schemaVersion: string;
  pairs: {
    [pairAddress: string]: {
      orders: DexScreenerOrder[];
    };
  };
}

interface DexScreenerToken {
  address: string;
  name: string;
  symbol: string;
  decimals: number;
  logoURI?: string;
  verified?: boolean;
}

interface DexScreenerTokenPair {
  chainId: string;
  dexId: string;
  url: string;
  pairAddress: string;
  baseToken: DexScreenerToken;
  quoteToken: DexScreenerToken;
  priceNative: string;
  priceUsd?: string;
  txns: {
    m5: {
      buys: number;
      sells: number;
    };
    h1: {
      buys: number;
      sells: number;
    };
    h6: {
      buys: number;
      sells: number;
    };
    h24: {
      buys: number;
      sells: number;
    };
  };
  volume: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  priceChange: {
    h24: number;
    h6: number;
    h1: number;
    m5: number;
  };
  liquidity?: {
    usd?: number;
    base: number;
    quote: number;
  };
  fdv?: number;
  marketCap?: number;
}

interface DexScreenerTokenPairsResponse {
  schemaVersion: string;
  pairs: DexScreenerTokenPair[];
}

interface DexScreenerTokensResponse {
  schemaVersion: string;
  tokens: {
    [tokenAddress: string]: {
      address: string;
      name: string;
      symbol: string;
      decimals: number;
      verified: boolean;
      description?: string;
      websiteUrl?: string;
      twitterUrl?: string;
      telegramUrl?: string;
      discordUrl?: string;
      auditUrls?: string[];
      logoURI?: string;
    };
  };
}

interface TokenAnalysisResult {
  tokenAddress: string;
  name: string;
  symbol: string;
  score: number;
  marketCap?: number;
  liquidity?: number;
  volume24h?: number;
  buyVsSellRatio: number;
  hasSocials: boolean;
  hasWebsite: boolean;
  verified: boolean;
  pairCount: number;
  buyCount: number;
  sellCount: number;
  recentOrders: DexScreenerOrder[];
  pairs: DexScreenerTokenPair[];
  tokenInfo: Record<string, unknown>;
  scoreBreakdown: {
    category: string;
    score: number;
    maxScore: number;
    details: string;
  }[];
  links: {
    website?: string;
    twitter?: string;
    telegram?: string;
    discord?: string;
    dexscreener?: string;
  };
}

interface MintsDataResponse {
  tokenMint: string;
  solMint: string;
  timestamp: number;
}

interface TransactionInstruction {
  programId: string;
  accounts: string[];
}

interface TransactionDetails {
  instructions: TransactionInstruction[];
  blockTime?: number;
}

interface TopHolder {
  address: string;
  amount: number;
  share: number;
}

interface Market {
  address: string;
  liquidity: number;
  lpProviders: number;
}

interface RugResponseExtended {
  token: {
    mintAuthority: string;
    freezeAuthority: string;
    isInitialized: boolean;
  };
  tokenMeta: {
    name: string;
    symbol: string;
    mutable: boolean;
  };
  detectedAt: string;
  topHolders: TopHolder[];
  markets: Market[];
  totalLPProviders: number;
  totalMarketLiquidity: number;
  rugged: boolean;
  score: number;
  risks?: {
    name: string;
    value: string;
    description: string;
    score: number;
    level: string;
  }[];
}

// We'll use environment variables for webhook configuration
// WEBHOOK_URL - The URL to send token information to
// WEBHOOK_TIMEOUT - Timeout in milliseconds for webhook requests (default: 10000)

// PumpPortal API types
interface PumpPortalNewTokenEvent {
  signature: string;
  mint: string;
  traderPublicKey: string;
  txType: string;
  initialBuy: number;
  solAmount: number;
  bondingCurveKey: string;
  vTokensInBondingCurve: number;
  vSolInBondingCurve: number;
  marketCapSol: number;
  name: string;
  symbol: string;
  uri: string;
  pool: string;
  timestamp?: number; // Optional timestamp
}

interface PumpPortalMigrationEvent {
  signature: string;
  mint: string;
  txType: string;
  pool: string;
  [key: string]: unknown;
}

// PumpPortal WebSocket connection
let pumpPortalWs: WebSocket | null = null;

async function getTokenCreationTime(tokenMint: string): Promise<number | null> {
  try {
    // Wait briefly for token to be indexed
    await new Promise(resolve => setTimeout(resolve, 2000));
    
    const response = await axios.get<RugResponseExtended>(`https://api.rugcheck.xyz/v1/tokens/${tokenMint}/report`, {
      timeout: config.tx.get_timeout
    });

    if (response.data && response.data.detectedAt) {
      const createdAt = new Date(response.data.detectedAt);
      return Math.floor(createdAt.getTime() / 1000);
    }
    return null;
  } catch (error) {
    if (error instanceof Error && error.message.includes('404')) {
      console.log('Token not yet indexed on rugcheck, using current time');
    } else {
      console.error("Error fetching token creation time:", error);
    }
    return null;
  }
}

async function fetchTransactionDetails(signature: string): Promise<MintsDataResponse | null> {
  const txUrl = process.env.HELIUS_HTTPS_URI_TX || "";
  
  if (!txUrl) {
    console.error("❌ HELIUS_HTTPS_URI_TX is not set in .env file");
    return null;
  }

  const maxRetries = 5;
  let retryCount = 0;

  // Initial delay
  const initialDelay = 2000;
  console.log(`⏳ Waiting for transaction confirmation...`);
  await new Promise((resolve) => setTimeout(resolve, initialDelay));

  while (retryCount < maxRetries) {
    try {
      const requestBody = {
        transactions: [signature],
        commitment: "confirmed",
        encoding: "jsonParsed",
      };

      const response = await axios.post<TransactionDetails[]>(
        txUrl,
        requestBody,
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000,
        }
      );

      // Verify if a response was received
      if (!response.data) {
        throw new Error("No response data received");
      }

      // Verify if the response was in the correct format and not empty
      if (!Array.isArray(response.data) || response.data.length === 0) {
        throw new Error("Response data array is empty");
      }

      const transactions = response.data;

      // Verify if transaction details were found
      if (!transactions[0]) {
        throw new Error("Transaction not found");
      }

      // Access the `instructions` property which contains account instructions
      const instructions = transactions[0].instructions;
      if (!instructions || !Array.isArray(instructions) || instructions.length === 0) {
        throw new Error("No instructions found in transaction");
      }

      // Verify and find the instructions for the correct market maker id
      const instruction = instructions.find((ix) => ix.programId === config.liquidity_pool.radiyum_program_id);
      if (!instruction || !instruction.accounts) {
        throw new Error("No market maker instruction found");
      }
      if (!Array.isArray(instruction.accounts) || instruction.accounts.length < 10) {
        throw new Error("Invalid accounts array in instruction");
      }

      // Store quote and token mints
      const accountOne = instruction.accounts[8];
      const accountTwo = instruction.accounts[9];

      // Verify if we received both quote and token mints
      if (!accountOne || !accountTwo) {
        throw new Error("Required accounts not found");
      }

      // Set new token and SOL mint
      let solTokenAccount = "";
      let newTokenAccount = "";
      if (accountOne === config.liquidity_pool.wsol_pc_mint) {
        solTokenAccount = accountOne;
        newTokenAccount = accountTwo;
      } else {
        solTokenAccount = accountTwo;
        newTokenAccount = accountOne;
      }

      console.log(`✅ Found new token: ${newTokenAccount}`);

      // Get token creation time from rugcheck
      const tokenTime = await getTokenCreationTime(newTokenAccount);
      const currentTime = Math.floor(Date.now() / 1000);
      const timestamp = tokenTime || currentTime;

      return {
        tokenMint: newTokenAccount,
        solMint: solTokenAccount,
        timestamp: timestamp
      };
    } catch (error) {
      if (error instanceof Error) {
        console.log(`❌ Attempt ${retryCount + 1} failed: ${error.message}`);
      }

      retryCount++;

      if (retryCount < maxRetries) {
        const delay = Math.min(2000 * Math.pow(1.5, retryCount), 20000);
        console.log(`⏳ Retrying in ${Math.round(delay / 1000)}s...`);
        await new Promise((resolve) => setTimeout(resolve, delay));
      }
    }
  }

  console.log("❌ Failed to fetch transaction details");
  return null;
}

/**
 * Send token information to a webhook
 * @param tokenMint The token mint address
 * @param customPayload Optional custom payload to send instead of generating one
 * @returns Promise<boolean> true if successful, false otherwise
 */
/**
 * Fetches orders paid for a token from DexScreener
 * @param tokenAddress The token address to check
 * @returns Promise with the orders data
 */
async function fetchTokenOrders(tokenAddress: string): Promise<DexScreenerOrdersResponse | null> {
  try {
    const url = `https://api.dexscreener.com/orders/v1/${SOLANA_CHAIN_ID}/${tokenAddress}`;
    console.log(`🔍 Fetching token orders from DexScreener: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000
    });
    
    if (response.status === 200 && response.data) {
      return response.data as DexScreenerOrdersResponse;
    }
    
    console.log(`❌ Failed to fetch token orders. Status: ${response.status}`);
    return null;
  } catch (error) {
    console.error('❌ Error fetching token orders:', error);
    return null;
  }
}

/**
 * Fetches token information from DexScreener
 * @param tokenAddress The token address to check
 * @returns Promise with the token data
 */
async function fetchTokenInfo(tokenAddress: string): Promise<DexScreenerTokensResponse | null> {
  try {
    const url = `https://api.dexscreener.com/tokens/v1/${SOLANA_CHAIN_ID}/${tokenAddress}`;
    console.log(`🔍 Fetching token info from DexScreener: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000
    });
    
    if (response.status === 200 && response.data) {
      return response.data as DexScreenerTokensResponse;
    }
    
    console.log(`❌ Failed to fetch token info. Status: ${response.status}`);
    return null;
  } catch (error) {
    console.error('❌ Error fetching token info:', error);
    return null;
  }
}

/**
 * Fetches token pairs from DexScreener
 * @param tokenAddress The token address to check
 * @returns Promise with the token pairs data
 */
async function fetchTokenPairs(tokenAddress: string): Promise<DexScreenerTokenPairsResponse | null> {
  try {
    const url = `https://api.dexscreener.com/token-pairs/v1/${SOLANA_CHAIN_ID}/${tokenAddress}`;
    console.log(`🔍 Fetching token pairs from DexScreener: ${url}`);
    
    const response = await axios.get(url, {
      timeout: 10000
    });
    
    if (response.status === 200 && response.data) {
      return response.data as DexScreenerTokenPairsResponse;
    }
    
    console.log(`❌ Failed to fetch token pairs. Status: ${response.status}`);
    return null;
  } catch (error) {
    console.error('❌ Error fetching token pairs:', error);
    return null;
  }
}

/**
 * Calculates a token score based on various metrics
 * @param result The token analysis result
 * @returns The updated token analysis result with score
 */
function calculateTokenScore(result: TokenAnalysisResult): TokenAnalysisResult {
  const scoreBreakdown: TokenAnalysisResult['scoreBreakdown'] = [];
  let totalScore = 0;
  
  // 1. Liquidity Score (0-25 points)
  let liquidityScore = 0;
  if (result.liquidity) {
    if (result.liquidity >= 100000) liquidityScore = 25;
    else if (result.liquidity >= 50000) liquidityScore = 20;
    else if (result.liquidity >= 25000) liquidityScore = 15;
    else if (result.liquidity >= 10000) liquidityScore = 10;
    else if (result.liquidity >= 5000) liquidityScore = 5;
    else liquidityScore = Math.floor((result.liquidity / 5000) * 5);
  }
  
  scoreBreakdown.push({
    category: 'Liquidity',
    score: liquidityScore,
    maxScore: 25,
    details: result.liquidity ? `$${result.liquidity.toLocaleString()}` : 'No liquidity data'
  });
  totalScore += liquidityScore;
  
  // 2. Buy vs Sell Ratio (0-20 points)
  let buyVsSellScore = 0;
  if (result.buyVsSellRatio > 0) {
    if (result.buyVsSellRatio >= 2) buyVsSellScore = 20;
    else if (result.buyVsSellRatio >= 1.5) buyVsSellScore = 15;
    else if (result.buyVsSellRatio >= 1.2) buyVsSellScore = 10;
    else if (result.buyVsSellRatio >= 1) buyVsSellScore = 5;
    else buyVsSellScore = 0;
  }
  
  scoreBreakdown.push({
    category: 'Buy/Sell Ratio',
    score: buyVsSellScore,
    maxScore: 20,
    details: `${result.buyCount} buys vs ${result.sellCount} sells (ratio: ${result.buyVsSellRatio.toFixed(2)})`
  });
  totalScore += buyVsSellScore;
  
  // 3. Volume Score (0-15 points)
  let volumeScore = 0;
  if (result.volume24h) {
    if (result.volume24h >= 100000) volumeScore = 15;
    else if (result.volume24h >= 50000) volumeScore = 12;
    else if (result.volume24h >= 25000) volumeScore = 9;
    else if (result.volume24h >= 10000) volumeScore = 6;
    else if (result.volume24h >= 5000) volumeScore = 3;
    else volumeScore = Math.floor((result.volume24h / 5000) * 3);
  }
  
  scoreBreakdown.push({
    category: '24h Volume',
    score: volumeScore,
    maxScore: 15,
    details: result.volume24h ? `$${result.volume24h.toLocaleString()}` : 'No volume data'
  });
  totalScore += volumeScore;
  
  // 4. Social Presence (0-15 points)
  let socialScore = 0;
  if (result.hasWebsite) socialScore += 5;
  if (result.links.twitter) socialScore += 3;
  if (result.links.telegram) socialScore += 3;
  if (result.links.discord) socialScore += 2;
  if (result.verified) socialScore += 2;
  
  scoreBreakdown.push({
    category: 'Social Presence',
    score: socialScore,
    maxScore: 15,
    details: `Website: ${result.hasWebsite ? 'Yes' : 'No'}, Twitter: ${result.links.twitter ? 'Yes' : 'No'}, Telegram: ${result.links.telegram ? 'Yes' : 'No'}, Discord: ${result.links.discord ? 'Yes' : 'No'}, Verified: ${result.verified ? 'Yes' : 'No'}`
  });
  totalScore += socialScore;
  
  // 5. Pair Count (0-10 points)
  let pairScore = 0;
  if (result.pairCount >= 3) pairScore = 10;
  else if (result.pairCount === 2) pairScore = 7;
  else if (result.pairCount === 1) pairScore = 5;
  
  scoreBreakdown.push({
    category: 'Trading Pairs',
    score: pairScore,
    maxScore: 10,
    details: `${result.pairCount} trading pairs`
  });
  totalScore += pairScore;
  
  // 6. Market Cap (0-15 points)
  let marketCapScore = 0;
  if (result.marketCap) {
    if (result.marketCap >= 10000000) marketCapScore = 15;
    else if (result.marketCap >= 5000000) marketCapScore = 12;
    else if (result.marketCap >= 1000000) marketCapScore = 9;
    else if (result.marketCap >= 500000) marketCapScore = 6;
    else if (result.marketCap >= 100000) marketCapScore = 3;
    else marketCapScore = Math.floor((result.marketCap / 100000) * 3);
  }
  
  scoreBreakdown.push({
    category: 'Market Cap',
    score: marketCapScore,
    maxScore: 15,
    details: result.marketCap ? `$${result.marketCap.toLocaleString()}` : 'No market cap data'
  });
  totalScore += marketCapScore;
  
  // Update the result with the calculated score
  result.score = totalScore;
  result.scoreBreakdown = scoreBreakdown;
  
  return result;
}

/**
 * Analyzes a token using DexScreener API data
 * @param tokenAddress The token address to analyze
 * @returns Promise with the token analysis result
 */
export async function analyzeToken(tokenAddress: string): Promise<TokenAnalysisResult | null> {
  console.log(`\n🔎 Analyzing token: ${tokenAddress}`);
  
  try {
    // Fetch data from all three DexScreener endpoints
    const [ordersData, tokenInfo, pairsData] = await Promise.all([
      fetchTokenOrders(tokenAddress),
      fetchTokenInfo(tokenAddress),
      fetchTokenPairs(tokenAddress)
    ]);
    
    // If we couldn't get any data, return null
    if (!ordersData && !tokenInfo && !pairsData) {
      console.log(`❌ Could not fetch any data for token: ${tokenAddress}`);
      return null;
    }
    
    // Initialize the result object
    const result: TokenAnalysisResult = {
      tokenAddress,
      name: 'Unknown',
      symbol: 'Unknown',
      score: 0,
      buyVsSellRatio: 0,
      hasSocials: false,
      hasWebsite: false,
      verified: false,
      pairCount: 0,
      buyCount: 0,
      sellCount: 0,
      recentOrders: [],
      pairs: [],
      tokenInfo: {} as Record<string, unknown>,
      scoreBreakdown: [],
      links: {}
    };
    
    // Process token info
    if (tokenInfo && tokenInfo.tokens && tokenInfo.tokens[tokenAddress]) {
      const token = tokenInfo.tokens[tokenAddress];
      result.tokenInfo = token as Record<string, unknown>;
      result.name = token.name || 'Unknown';
      result.symbol = token.symbol || 'Unknown';
      result.verified = token.verified || false;
      
      // Check for socials and website
      if (token.websiteUrl) {
        result.hasWebsite = true;
        result.links.website = token.websiteUrl;
      }
      
      if (token.twitterUrl) {
        result.links.twitter = token.twitterUrl;
      }
      
      if (token.telegramUrl) {
        result.links.telegram = token.telegramUrl;
      }
      
      if (token.discordUrl) {
        result.links.discord = token.discordUrl;
      }
      
      result.hasSocials = !!(token.twitterUrl || token.telegramUrl || token.discordUrl);
    }
    
    // Process pairs data
    if (pairsData && pairsData.pairs) {
      result.pairs = pairsData.pairs;
      result.pairCount = pairsData.pairs.length;
      
      // Add DexScreener link
      if (result.pairCount > 0) {
        result.links.dexscreener = `https://dexscreener.com/${SOLANA_CHAIN_ID}/${pairsData.pairs[0].pairAddress}`;
      }
      
      // Calculate total liquidity, volume, and market cap
      let totalLiquidity = 0;
      let totalVolume24h = 0;
      let marketCap = 0;
      
      for (const pair of pairsData.pairs) {
        if (pair.liquidity && pair.liquidity.usd) {
          totalLiquidity += pair.liquidity.usd;
        }
        
        if (pair.volume && pair.volume.h24) {
          totalVolume24h += pair.volume.h24;
        }
        
        // Take the highest market cap value
        if (pair.marketCap && (!marketCap || pair.marketCap > marketCap)) {
          marketCap = pair.marketCap;
        }
        
        // Count buys and sells
        if (pair.txns) {
          result.buyCount += pair.txns.h24.buys || 0;
          result.sellCount += pair.txns.h24.sells || 0;
        }
      }
      
      result.liquidity = totalLiquidity;
      result.volume24h = totalVolume24h;
      result.marketCap = marketCap;
      
      // Calculate buy vs sell ratio
      if (result.sellCount > 0) {
        result.buyVsSellRatio = result.buyCount / result.sellCount;
      } else if (result.buyCount > 0) {
        result.buyVsSellRatio = 999; // Very high ratio if no sells but some buys
      }
    }
    
    // Process orders data
    if (ordersData && ordersData.pairs) {
      // Collect all orders from all pairs
      const allOrders: DexScreenerOrder[] = [];
      
      for (const pairAddress in ordersData.pairs) {
        if (ordersData.pairs[pairAddress].orders) {
          allOrders.push(...ordersData.pairs[pairAddress].orders);
        }
      }
      
      // Sort by most recent first
      allOrders.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      
      // Take the 20 most recent orders
      result.recentOrders = allOrders.slice(0, 20);
    }
    
    // Calculate the token score
    const scoredResult = calculateTokenScore(result);
    
    // Save the analysis result to a file
    const outputDir = path.join(process.cwd(), 'token-analysis');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const outputFile = path.join(outputDir, `analysis-${tokenAddress}-${timestamp}.json`);
    
    fs.writeFileSync(outputFile, JSON.stringify(scoredResult, null, 2));
    console.log(`💾 Saved token analysis to: ${path.basename(outputFile)}`);
    
    return scoredResult;
  } catch (error) {
    console.error('❌ Error analyzing token:', error);
    return null;
  }
}

/**
 * Generates a human-readable report for a token
 * @param analysis The token analysis result
 * @returns A formatted string with the token report
 */
export function generateTokenReport(analysis: TokenAnalysisResult): string {
  const scoreColor = analysis.score >= 70 ? '🟢' : analysis.score >= 40 ? '🟠' : '🔴';
  
  let report = `
📊 Token Analysis Report for ${analysis.name} (${analysis.symbol})
${scoreColor} Overall Score: ${analysis.score}/100

📈 Key Metrics:
- Market Cap: ${analysis.marketCap ? `$${analysis.marketCap.toLocaleString()}` : 'Unknown'}
- Liquidity: ${analysis.liquidity ? `$${analysis.liquidity.toLocaleString()}` : 'Unknown'}
- 24h Volume: ${analysis.volume24h ? `$${analysis.volume24h.toLocaleString()}` : 'Unknown'}
- Trading Pairs: ${analysis.pairCount}
- 24h Transactions: ${analysis.buyCount} buys, ${analysis.sellCount} sells (ratio: ${analysis.buyVsSellRatio.toFixed(2)})
- Verified: ${analysis.verified ? 'Yes ✓' : 'No ✗'}

🔗 Links:
${analysis.links.website ? `- Website: ${analysis.links.website}` : '- Website: None'}
${analysis.links.twitter ? `- Twitter: ${analysis.links.twitter}` : '- Twitter: None'}
${analysis.links.telegram ? `- Telegram: ${analysis.links.telegram}` : '- Telegram: None'}
${analysis.links.discord ? `- Discord: ${analysis.links.discord}` : '- Discord: None'}
${analysis.links.dexscreener ? `- DexScreener: ${analysis.links.dexscreener}` : ''}

📝 Score Breakdown:
`;

  // Add score breakdown
  for (const category of analysis.scoreBreakdown) {
    const percentage = Math.round((category.score / category.maxScore) * 100);
    const bar = '█'.repeat(Math.floor(percentage / 10)) + '░'.repeat(10 - Math.floor(percentage / 10));
    report += `- ${category.category}: ${category.score}/${category.maxScore} [${bar}] ${percentage}%\n  ${category.details}\n`;
  }
  
  // Add recent transactions if available
  if (analysis.recentOrders && analysis.recentOrders.length > 0) {
    report += '\n🔄 Recent Transactions:\n';
    
    for (let i = 0; i < Math.min(5, analysis.recentOrders.length); i++) {
      const order = analysis.recentOrders[i];
      const time = new Date(order.createdAt).toLocaleString();
      const type = order.type === 'buy' ? '🟢 Buy' : '🔴 Sell';
      report += `- ${type}: $${parseFloat(order.amountInUsd).toLocaleString()} at ${time}\n`;
    }
  }
  
  // Add recommendation based on score
  report += '\n💡 Recommendation: ';
  if (analysis.score >= 70) {
    report += 'This token shows strong potential with good liquidity, active trading, and established presence.';
  } else if (analysis.score >= 40) {
    report += 'This token shows moderate potential but has some concerning metrics. Exercise caution.';
  } else {
    report += 'This token shows significant risk factors. Approach with extreme caution.';
  }
  
  return report;
}

/**
 * Main function to analyze a token and generate a report
 * @param tokenAddress The token address to analyze
 * @returns Promise with the analysis result and report
 */
export async function analyzeTokenAndGenerateReport(tokenAddress: string): Promise<{
  analysis: TokenAnalysisResult | null;
  report: string | null;
}> {
  const analysis = await analyzeToken(tokenAddress);
  
  if (!analysis) {
    return { analysis: null, report: null };
  }
  
  const report = generateTokenReport(analysis);
  return { analysis, report };
}

async function sendTokenToWebhook(tokenMint: string, customPayload?: Record<string, unknown>): Promise<boolean> {
  try {
    // Check if webhook is enabled in config
    if (!process.env.WEBHOOK_URL) {
      console.log("⚠️ WEBHOOK_URL not set in environment variables. Skipping webhook notification.");
      return false;
    }
    
    const webhookUrl = process.env.WEBHOOK_URL;
    const timeout = parseInt(process.env.WEBHOOK_TIMEOUT || '10000');
    
    // Analyze the token using DexScreener API
    console.log(`🔍 Analyzing token ${tokenMint} before sending to webhook...`);
    const { analysis, report } = await analyzeTokenAndGenerateReport(tokenMint);
    
    // Use custom payload if provided, otherwise generate one
    let payload: Record<string, unknown>;
    
    if (customPayload) {
      // If custom payload is provided, add the analysis to it
      payload = {
        ...customPayload,
        tokenAnalysis: analysis || undefined,
        tokenReport: report || undefined
      };
    } else {
      // Generate a new payload with token analysis
      payload = {
        tokenAddress: tokenMint,
        timestamp: new Date().toISOString(),
        links: {
          axiom: `https://axiom.trade/meme/${tokenMint}`,
          gmgn: `https://gmgn.ai/sol/token/${tokenMint}`,
          bullx: `https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenMint}`,
          solscan: `https://solscan.io/token/${tokenMint}`,
          raydium: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${tokenMint}`,
          jupiter: `https://jup.ag/swap/SOL-${tokenMint}`
        },
        tokenAnalysis: analysis || undefined,
        tokenReport: report || undefined,
        tokenScore: analysis ? analysis.score : undefined
      };
    }
    
    console.log(`🔄 Sending token to webhook: ${tokenMint}${analysis ? ` (Score: ${analysis.score}/100)` : ''}`);
    
    // Send to webhook
    const response = await axios.post(webhookUrl, payload, {
      headers: {
        'Content-Type': 'application/json'
      },
      timeout
    });
    
    // Save response to a file for debugging
    const outputDir = path.join(process.cwd(), 'webhook-responses');
    if (!fs.existsSync(outputDir)) {
      fs.mkdirSync(outputDir, { recursive: true });
    }
    
    const timestamp = new Date().toISOString().replace(/:/g, '-');
    const outputFile = path.join(outputDir, `webhook-${tokenMint}-${timestamp}.json`);
    
    if (response.status >= 200 && response.status < 300) {
      console.log(`✅ Successfully sent token to webhook (Status: ${response.status})`);
      
      fs.writeFileSync(outputFile, JSON.stringify({
        success: true,
        tokenMint,
        timestamp: new Date().toISOString(),
        statusCode: response.status,
        statusText: response.statusText,
        data: response.data,
        tokenScore: analysis ? analysis.score : undefined
      }, null, 2));
      
      console.log(`💾 Saved webhook response to: ${path.basename(outputFile)}`);
      return true;
    } else {
      console.error(`❌ Failed to send to webhook. Status: ${response.status}`);
      return false;
    }
  } catch (error) {
    if (error instanceof Error) {
      console.error("❌ Error sending to webhook:", error.message);
    } else {
      console.error("❌ Unknown error sending to webhook");
    }
    return false;
  }
}

// Function to send the subscription request
function sendSubscribeRequest(ws: WebSocket): void {
  console.log("📡 Sending subscription request...");
  const request: WebSocketRequest = {
    jsonrpc: "2.0",
    id: "1",
    method: "logsSubscribe",
    params: [
      {
        mentions: [config.liquidity_pool.radiyum_program_id],
      },
      {
        commitment: "processed",
      },
    ],
  };
  ws.send(JSON.stringify(request));
}

// Function to process a transaction
async function processTransaction(signature: string): Promise<void> {
  try {
    console.log("⏳ Waiting for transaction confirmation...");
    const txInfo = await fetchTransactionDetails(signature);

    if (!txInfo) {
      console.log("❌ Could not fetch transaction info");
      return;
    }

    const { tokenMint, timestamp } = txInfo;
    
    // Check if token is too old using config value
    const now = Math.floor(Date.now() / 1000);
    const minutesOld = (now - timestamp) / 60;
    const maxAge = config.twitter_search?.max_token_age_minutes || 40;
    
    if (minutesOld > maxAge) {
      console.log(`❌ Token is ${Math.round(minutesOld)} minutes old. Skipping tokens older than ${maxAge} minutes.`);
      return;
    }

    console.log(`✅ Found new token: ${tokenMint} (${Math.round(minutesOld)} minutes old)`);
    
    // Output logs
    console.log("Token found");
    console.log("👽 GMGN: https://gmgn.ai/sol/token/" + tokenMint);
    console.log("😈 BullX: https://neo.bullx.io/terminal?chainId=1399811149&address=" + tokenMint);

    // Send token to webhook
    console.log("🔄 Sending token to webhook...");
    const webhookSuccess = await sendTokenToWebhook(tokenMint);
    
    if (!webhookSuccess) {
      console.log("⚠️ Failed to send to webhook, but continuing with Telegram notification if enabled.");
    } else {
      console.log("✅ Token address sent to webhook successfully.");
    }

    // Send token to group if telegram is enabled
    // if (config.telegram.enabled) {
    //   console.log("🔄 Sending token to Telegram...");
    //   await sendTokenToGroup(tokenMint);
    //   console.log("✅ Token address sent to Telegram successfully.");
    // }
    
    console.log("🟢 Resuming looking for new tokens...\n");
  } catch (error) {
    console.error("Error processing transaction:", error);
  }
}


// Main function to start the WebSocket connections
let init = false;
let activeTransactions = 0;
const MAX_CONCURRENT = 10;

/**
 * Initialize and handle PumpPortal WebSocket connection
 */
async function initPumpPortalWebSocket(): Promise<void> {
  try {
    // Close existing connection if any
    if (pumpPortalWs) {
      try {
        pumpPortalWs.terminate();
      } catch (err) {
        console.error("Error terminating existing connection:", err);
      }
      pumpPortalWs = null;
    }
    
    console.log("🔄 Connecting to PumpPortal API...");
    pumpPortalWs = new WebSocket('wss://pumpportal.fun/api/data');
    
    pumpPortalWs!.on('open', function() {
      console.log("✅ Connected to PumpPortal API");
      
      // Subscribe to migration events
      const migrationPayload = {
        method: "subscribeMigration"
      };
      pumpPortalWs!.send(JSON.stringify(migrationPayload));
      console.log("✅ Subscribed to migration events");
      
      // Subscribe to token creation events
    //   const newTokenPayload = {
    //     method: "subscribeNewToken"
    //   };
    //   pumpPortalWs!.send(JSON.stringify(newTokenPayload));
    //   console.log("✅ Subscribed to token creation events");
    });
    
    pumpPortalWs!.on('message', async function(data) {
      try {
        const parsedData = JSON.parse(data.toString());
        
        // Check if it's a subscription confirmation message
        if (parsedData.message && typeof parsedData.message === 'string') {
          console.log(`✅ PumpPortal: ${parsedData.message}`);
          return;
        }
        
        // Check for migration event based on the actual format
        if (parsedData.txType === 'migrate' && parsedData.mint) {
          const migrationData = parsedData as PumpPortalMigrationEvent;
          console.log(`🔄 Token migration detected: ${migrationData.mint} (${migrationData.pool})`);
          console.log(`🔄 Migration signature: ${migrationData.signature}`);
          
          // Process the migration event
          await processPumpPortalToken(migrationData.mint, 'migration', migrationData);
        }
      } catch (error) {
        console.error("❌ Error processing PumpPortal message:", error);
      }
    });
    
    pumpPortalWs!.on('error', function(error) {
      console.error("❌ PumpPortal WebSocket error:", error);
    });
    
    pumpPortalWs!.on('close', function() {
      console.log("📴 PumpPortal WebSocket connection closed");
      console.log("🔄 Attempting to reconnect in 5 seconds...");
      
      // Attempt to reconnect after a delay
      setTimeout(() => {
        initPumpPortalWebSocket().catch(console.error);
      }, 5000);
    });
    
  } catch (error) {
    console.error("❌ Error initializing PumpPortal WebSocket:", error);
    console.log("🔄 Attempting to reconnect in 10 seconds...");
    
    // Attempt to reconnect after a longer delay
    setTimeout(() => {
      initPumpPortalWebSocket().catch(console.error);
    }, 10000);
  }
}

/**
 * Process a token from PumpPortal API
 * @param tokenMint The token mint address
 * @param eventType The type of event (creation or migration)
 * @param eventData Additional event data
 */
async function processPumpPortalToken(tokenMint: string, eventType: 'creation' | 'migration', eventData: PumpPortalNewTokenEvent | PumpPortalMigrationEvent): Promise<void> {
  try {
    console.log(`🔍 Processing ${eventType} event for token: ${tokenMint}`);
    
    // Send to webhook
    console.log("🔄 Sending token to webhook...");
    
    // Get token creation time (if not provided in the event data)
    let creationTime = 'Unknown';
    if ('timestamp' in eventData && typeof eventData.timestamp === 'number') {
      creationTime = new Date(eventData.timestamp * 1000).toISOString();
    } else {
      const timestamp = await getTokenCreationTime(tokenMint);
      if (timestamp) {
        creationTime = new Date(timestamp * 1000).toISOString();
      }
    }
    
    // Prepare payload
    const payload = {
      tokenAddress: tokenMint,
      source: "pumpportal",
      eventType: eventType,
      timestamp: new Date().toISOString(),
      creationTime: creationTime !== 'Unknown' ? creationTime : null,
      eventData: eventData,
      links: {
        axiom: `https://axiom.trade/meme/${tokenMint}`,
        gmgn: `https://gmgn.ai/sol/token/${tokenMint}`,
        bullx: `https://neo.bullx.io/terminal?chainId=1399811149&address=${tokenMint}`,
        solscan: `https://solscan.io/token/${tokenMint}`,
        raydium: `https://raydium.io/swap/?inputCurrency=sol&outputCurrency=${tokenMint}`,
        jupiter: `https://jup.ag/swap/SOL-${tokenMint}`
      },
      prompt: `What are the chances of this token ${tokenMint} deployed on the solana blockchain and the pumpfun platform being a rug versus it becoming a token that can reach atleast 1 million dollar marketcap, use the tools you have to get all the details of this token give it a score of 1-100 100 being the best`
    };
    
    // Send to webhook
    const webhookSuccess = await sendTokenToWebhook(tokenMint, payload);
    
    if (!webhookSuccess) {
      console.log("⚠️ Failed to send PumpPortal event to webhook");
    } else {
      console.log("✅ PumpPortal event sent to webhook successfully");
    }
    
  } catch (error) {
    console.error(`❌ Error processing PumpPortal ${eventType} event:`, error);
  }
}

async function websocketHandler(): Promise<void> {
  // Load environment variables from the .env file
  const env = validateEnv();

  // Create a WebSocket connection
  let ws: WebSocket | null = new WebSocket(env.HELIUS_WSS_URI);
  if (!init) console.clear();

  // Send subscription to the websocket once the connection is open
  ws.on("open", () => {
    if (ws) sendSubscribeRequest(ws);
    console.log("\n🔓 WebSocket is open and listening.");
    init = true;
  });

  // Logic for the message event for the .on event listener
  ws.on("message", async (data: WebSocket.Data) => {
    try {
      const jsonString = data.toString();
      const parsedData = JSON.parse(jsonString);

      // Handle subscription response
      if (parsedData.result !== undefined && !parsedData.error) {
        console.log("✅ Subscription confirmed");
        return;
      }

      // Only log RPC errors for debugging
      if (parsedData.error) {
        console.error("🚫 RPC Error:", parsedData.error);
        return;
      }

      // Safely access the nested structure
      const logs = parsedData?.params?.result?.value?.logs;
      const signature = parsedData?.params?.result?.value?.signature;

      // Validate `logs` is an array and if we have a signature
      if (!Array.isArray(logs) || !signature) return;

      // Verify if this is a new pool creation
      const containsCreate = logs.some((log: string) => 
        typeof log === "string" && log.includes("Program log: initialize2: InitializeInstruction2")
      );
      if (!containsCreate || typeof signature !== "string") return;

      // Verify if we have reached the max concurrent transactions
      if (activeTransactions >= MAX_CONCURRENT) {
        console.log("⏳ Max concurrent transactions reached, skipping...");
        return;
      }

      // Add additional concurrent transaction
      activeTransactions++;

      // Process transaction asynchronously
      processTransaction(signature)
        .catch((error) => {
          console.error("Error processing transaction:", error);
        })
        .finally(() => {
          activeTransactions--;
        });

    } catch (error) {
      console.error("💥 Error processing message:", {
        error: error instanceof Error ? error.message : "Unknown error",
        timestamp: new Date().toISOString(),
      });
    }
  });

  ws.on("error", (err: Error) => {
    console.error("WebSocket error:", err);
  });

  ws.on("close", () => {
    console.log("📴 WebSocket connection closed, cleaning up...");
    if (ws) {
      ws.removeAllListeners();
      ws = null;
    }
    console.log("🔄 Attempting to reconnect in 5 seconds...");
    setTimeout(websocketHandler, 5000);
  });
}

// Main function
async function main(): Promise<void> {
  try {
    // Validate environment variables
    validateEnv();

    // Initialize Telegram if enabled
    if (config.telegram.enabled) {
      await initTelegram();
    }

    // Check if webhook URL is set
    if (!process.env.WEBHOOK_URL) {
      console.log('⚠️ WEBHOOK_URL not set in environment variables. Tokens will not be sent to webhook.');
    } else {
      console.log(`✅ Webhook URL configured: ${process.env.WEBHOOK_URL}`);
    }

    // Handle cleanup on process exit
    const cleanup = async () => {
      console.log('\nCleaning up...');
      if (pumpPortalWs) {
        console.log('Closing PumpPortal WebSocket connection...');
        pumpPortalWs.terminate();
        pumpPortalWs = null;
      }
      process.exit();
    };

    process.on('SIGINT', cleanup);
    process.on('SIGTERM', cleanup);

    // Initialize PumpPortal WebSocket
    await initPumpPortalWebSocket();
    
    // Start Helius WebSocket handler
    await websocketHandler();
  } catch (error) {
    console.error("Error starting application:", error);
    process.exit(1);
  }
}

// Start the application
main().catch((error: unknown) => {
  if (error instanceof Error) {
    console.error("Fatal error:", error.message);
  }
  process.exit(1);
});
