This repository contains all the code "as is", following the "Solana Sniper Trading Bot in TypeScript" on YouTube provided by [DigitalBenjamins](https://x.com/digbenjamins).

[![Solana Sniper Trading Bot in TypeScript](https://img.youtube.com/vi/vsMbnsdHOIQ/0.jpg)](https://www.youtube.com/watch?v=vsMbnsdHOIQ)

You can find the YouTube tutorial here: https://www.youtube.com/watch?v=vsMbnsdHOIQ

## Project Description

The Solana Token Sniper is a Node.js project built with TypeScript, designed to automate the buying and selling of tokens on the Solana blockchain. This script is configured to detect the creation of new liquidity pools and execute token purchases automatically.

With customizable parameters, you can tailor the strategy to suit your needs. The primary goal of this project is to educate users about the essential components required to develop a simple token sniper, offering insights into its functionality and implementation.

### Features

- Token Sniper for Raydium for the Solana blockchain
- Rug check using a third party service rugcheck.xyz
- Possibility to skip pump.fun tokens
- Auto-buy with parameters for amount, slippage and priority
- Possibility to set own RPC nodes
- Utils: Solana Wallet (keypair) creator

### Update Log

- 18-dec-2024-22: Added tracker functionality in "src\tracker\index.ts".
- 18-dec-2024-22: Updated fetchAndSaveSwapDetails() in transactions.ts to use sqlite3.
- 18-dec-2024-22: Updated config.ts: Addded sell parameters
- 18-dec-2024-22: Added packages: luxon, sqlite, sqlite3
- 17-dec-2024-13: Added fetchAndSaveSwapDetails() in transactions.ts to track confirmed swaps.
- 17-dec-2024-13: Updated test.ts
- 17-dec-2024-13: Added JUP_HTTPS_PRICE_URI to .env.backup
- 17-dec-2024-13: Web3.js updated from 1.95.8 to 1.98.0
- 06-dec-2024-00: Initial Commit: Solana Sniper Bot

### Third Party documentation

- [Helius RPC nodes](https://docs.helius.dev)
- [Jupiter V6 Swap API](https://station.jup.ag/docs/apis/swap-api)
- [Rugcheck API](https://api.rugcheck.xyz/swagger/index.html)
- [Solana](https://solana.com/docs)
- [Solscan](https://solscan.io)

### Disclaimer

The course videos accompanying this project are provided free of charge and are intended solely for educational purposes. This software does not guarantee profitability or financial success and is not designed to generate profitable trades.

You are solely responsible for your own financial decisions. Before making any trades or investments, it is strongly recommended that you consult with a qualified financial professional.

By using this software, you acknowledge that the creators and contributors of this project shall not be held liable for any financial losses, damages, or other consequences resulting from its use. Use the software at your own risk.
