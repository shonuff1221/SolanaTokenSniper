/* eslint-disable @typescript-eslint/no-explicit-any */
export interface TransactionData {
    tokenMint: string;
    solMint: string;
    name?: string;
    creator?: string;
}

export interface TransactionDetailsResponseArray {
    [key: string]: any;
}

export interface SerializedQuoteResponse {
    swapTransaction: string;
    lastValidBlockHeight: number;
    prioritizationFeeLamports: number;
    computeUnitLimit: number;
    prioritizationType: any;
    simulationSlot: number;
    dynamicSlippageReport?: {
        slippageBps: number;
        otherAmount: number;
        simulatedIncurredSlippageBps: number;
        amplificationRatio: string | null;
        categoryName: string;
        heuristicMaxSlippageBps: number;
        rtseSlippageBps: number;
    };
    simulationError: any;
}

export interface RugResponseExtended {
    success: boolean;
    data?: {
        is_verified: boolean;
        is_rugpull: boolean;
        confidence: number;
    };
    error?: string;
}

export interface NewTokenRecord {
    mint: string;
    name: string;
    creator: string;
    created_at: string;
}

export interface createSellTransactionResponse {
    success: boolean;
    msg: string | null;
    tx: string | null;
}

export interface JupiterQuoteResponse {
    inputMint: string;
    inAmount: string;
    outputMint: string;
    outAmount: string;
    otherAmountThreshold: string;
    swapMode: string;
    slippageBps: number;
    platformFee: any;
    priceImpactPct: string;
    routePlan: Array<{
        swapInfo: {
            ammKey: string;
            label: string;
            inputMint: string;
            outputMint: string;
            inAmount: string;
            outAmount: string;
            feeAmount: string;
            feeMint: string;
        };
        percent: number;
    }>;
    contextSlot: number;
    timeTaken: number;
    swapUsdValue: string;
}
