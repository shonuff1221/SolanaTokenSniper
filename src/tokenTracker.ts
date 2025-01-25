import { Connection, PublicKey, ConfirmedSignatureInfo } from '@solana/web3.js';
import { DateTime } from 'luxon';
import * as dotenv from 'dotenv';
import axios, { AxiosResponse } from 'axios';
import { config } from './config';

dotenv.config();

interface TokenHolder {
    wallet: string;
    tokensBought: number;
    tokensSold: number;
    firstBuyTime: DateTime;
    isLiquidityProvider: boolean;
}

interface TokenTransfer {
    fromUserAccount: string;
    toUserAccount: string;
    tokenAmount: number;
    mint: string;
}

interface SwapEvent {
    tokenInputs: TokenTransfer[];
    tokenOutputs: TokenTransfer[];
    type: string;
    timestamp: number;
    programInfo?: {
        programName: string;
        account: string;
    };
}

interface HeliusTransaction {
    description: string;
    type: string;
    source: string;
    signature: string;
    timestamp: number;
    events: {
        swap?: SwapEvent;
    };
    accountData: {
        account: string;
        nativeBalanceChange: number;
        tokenBalanceChanges: {
            userAccount: string;
            tokenAccount: string;
            mint: string;
            tokenAmount: number;
        }[];
    }[];
}

type HeliusResponse = HeliusTransaction[];

async function getTokenHolders(tokenAddress: string): Promise<TokenHolder[]> {
    const heliusUri = process.env.HELIUS_HTTPS_URI;
    const heliusTxUri = process.env.HELIUS_HTTPS_URI_TX;

    if (!heliusUri || !heliusTxUri) {
        throw new Error('HELIUS_HTTPS_URI or HELIUS_HTTPS_URI_TX not found in environment variables');
    }

    // Connect to Helius RPC
    const connection = new Connection(heliusUri);
    const tokenPublicKey = new PublicKey(tokenAddress);
    
    // Get all signatures first
    console.log('Getting all signatures...');
    let allSignatures: ConfirmedSignatureInfo[] = [];
    let lastSig: string | undefined = undefined;
    
    while (true) {
        const signatures = await connection.getSignaturesForAddress(
            tokenPublicKey,
            { before: lastSig, limit: 1000 }
        );
        
        if (signatures.length === 0) break;
        
        allSignatures = [...allSignatures, ...signatures];
        lastSig = signatures[signatures.length - 1].signature;
        
        console.log(`Found ${allSignatures.length} total signatures...`);
    }
    
    // Sort signatures by blockTime to get earliest first
    console.log('Sorting signatures by time...');
    allSignatures.sort((a, b) => (a.blockTime || 0) - (b.blockTime || 0));
    
    const holders: Map<string, TokenHolder> = new Map();
    let processedCount = 0;
    let swapsFound = 0;

    console.log('Processing earliest transactions...');

    // Process transactions in batches to avoid rate limits
    const batchSize = 15;
    for (let i = 0; i < allSignatures.length && swapsFound < 50; i += batchSize) {
        const batch = allSignatures.slice(i, i + batchSize);
        
        try {
            // Get transaction data for the entire batch at once
            const response: AxiosResponse<HeliusResponse> = await axios.post(
                heliusTxUri,
                { transactions: batch.map(sig => sig.signature) },
                { timeout: config.tx.get_timeout }
            );

            if (!response.data) continue;

            for (const tx of response.data) {
                if (!tx.events?.swap) continue;

                // Only process Raydium swaps
                const isRaydiumSwap = tx.accountData?.some(data => 
                    data.account === config.liquidity_pool.radiyum_program_id
                );

                if (!isRaydiumSwap) continue;
                
                console.log('\nFound Raydium swap:', tx.signature);

                // Process token balance changes
                const tokenChanges = tx.accountData
                    .filter(data => data.tokenBalanceChanges?.length > 0)
                    .flatMap(data => data.tokenBalanceChanges)
                    .filter(change => change.mint === tokenAddress);

                console.log('Token balance changes:', tokenChanges);

                for (const change of tokenChanges) {
                    const wallet = change.userAccount;
                    if (!wallet) continue;

                    // Get the account data to check the balance change
                    const accountData = tx.accountData.find(data => 
                        data.tokenBalanceChanges?.some(c => c.userAccount === wallet)
                    );

                    if (!accountData) continue;

                    // If balance change is positive, it's a buy
                    const balanceChange = accountData.tokenBalanceChanges
                        ?.find(c => c.userAccount === wallet && c.mint === tokenAddress);

                    if (balanceChange) {
                        let holder = holders.get(wallet);
                        if (!holder) {
                            holder = {
                                wallet,
                                tokensBought: 0,
                                tokensSold: 0,
                                firstBuyTime: DateTime.fromSeconds(tx.timestamp),
                                isLiquidityProvider: false
                            };
                            holders.set(wallet, holder);
                            console.log('New holder found:', wallet);
                        }

                        // Check if this is a liquidity provider
                        const isLPProvider = Math.abs(accountData.nativeBalanceChange) > 1e8; // More than 0.1 SOL
                        if (isLPProvider) {
                            holder.isLiquidityProvider = true;
                            console.log('Marked as LP provider:', wallet);
                        }

                        // Update token amounts
                        if (accountData.nativeBalanceChange < 0) { // Spent SOL = buying tokens
                            holder.tokensBought += Math.abs(balanceChange.tokenAmount);
                            console.log(`Added ${Math.abs(balanceChange.tokenAmount)} tokens bought to ${wallet}`);
                        } else { // Received SOL = selling tokens
                            holder.tokensSold += Math.abs(balanceChange.tokenAmount);
                            console.log(`Added ${Math.abs(balanceChange.tokenAmount)} tokens sold to ${wallet}`);
                        }
                    }
                }
                
                swapsFound++;
                if (swapsFound >= 50) break;
            }

            processedCount += batch.length;
            console.log(`\nProcessed ${processedCount} transactions, found ${swapsFound} Raydium swaps, ${holders.size} unique buyers...`);
            
            // Add a delay between batches based on config
            await new Promise(resolve => setTimeout(resolve, config.tx.retry_delay));
            
        } catch (error) {
            if (axios.isAxiosError(error) && error.response?.status === 429) {
                console.log('Rate limited. Waiting...');
                await new Promise(resolve => setTimeout(resolve, config.tx.fetch_tx_initial_delay));
                i -= batchSize; // Retry this batch
                continue;
            }
            console.error('Error processing batch:', error instanceof Error ? error.message : String(error));
        }
    }

    // Sort holders by first buy time
    const sortedHolders = Array.from(holders.values())
        .sort((a, b) => a.firstBuyTime.toMillis() - b.firstBuyTime.toMillis())
        .slice(0, 50);

    return sortedHolders;
}

async function main(): Promise<void> {
    const args = process.argv.slice(2);
    if (args.length !== 1) {
        console.error('Please provide a token address as an argument');
        process.exit(1);
    }

    const tokenAddress = args[0];
    console.log(`Analyzing token: ${tokenAddress}`);

    try {
        const holders = await getTokenHolders(tokenAddress);
        
        console.log('\nFirst 50 token buyers:');
        console.log('----------------------------------------');
        holders.forEach((holder, index) => {
            console.log(`${index + 1}. Wallet: ${holder.wallet}`);
            console.log(`   Tokens Bought: ${holder.tokensBought}`);
            console.log(`   Tokens Sold: ${holder.tokensSold}`);
            console.log(`   First Buy: ${holder.firstBuyTime.toFormat('yyyy-MM-dd HH:mm:ss')}`);
            console.log(`   Is LP Provider: ${holder.isLiquidityProvider}`);
            console.log('----------------------------------------');
        });
    } catch (error) {
        console.error('Error:', error instanceof Error ? error.message : String(error));
    }
}

main().catch(error => {
    console.error('Unhandled error:', error instanceof Error ? error.message : String(error));
    process.exit(1);
});
