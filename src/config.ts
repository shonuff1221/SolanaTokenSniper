export const config = {
  liquidity_pool: {
    radiyum_program_id: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    wsol_pc_mint: "So11111111111111111111111111111111111111112",
  },
  token: {
    wsol_pc_mint: "So11111111111111111111111111111111111111112",
  },
  telegram: {
    enabled: true,
    auto_buy: false, // If true, will also trigger buy when token is posted
  },
  tx: {
    fetch_tx_max_retries: 3,          // Increased from 3 to 5
    fetch_tx_initial_delay: 1000,     // Increased from 2000 to 4000
    swap_tx_initial_delay: 1000,
    get_timeout: 10000,
    concurrent_transactions: 1,
    retry_delay: 1000,
    max_retries: 3
  },
  swap: {
    verbose_log: true,
    prio_fee_max_lamports: 5000000, // 0.005 SOL - increased for better priority
    prio_level: "veryHigh", // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
    amount: "10000000", //0.01 SOL
    slippageBps: "1500", // 15%
    db_name_tracker_holdings: "src/tracker/holdings.db", // Sqlite Database location
    token_not_tradable_400_error_retries: 10, // How many times should the bot try to get a quote if the token is not tradable yet
    token_not_tradable_400_error_delay: 10, // How many seconds should the bot wait before retrying to get a quote again
  },
  sell: {
    price_source: "dex", // dex=Dexscreener,jup=Jupiter Agregator (Dex is most accurate and Jupiter is always used as fallback)
    prio_fee_max_lamports: 5000000, // 0.005 SOL
    prio_level: "veryHigh", // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
    slippageBps: "1500", // 15%
    auto_sell: false, // If set to true, stop loss and take profit triggers automatically when set.
    stop_loss_percent: 15,
    take_profit_percent: 50,
    track_public_wallet: "FyTp8YSU8VtRAAsg3esa1r6mLpVzx5PF1Z4VZtVwnQKs", // If set an additional log line will be shown with a link to track your wallet
  },
  rug_check: {
    verbose_log: false,
    simulation_mode: false,
    // Dangerous
    allow_mint_authority: false, // The mint authority is the address that has permission to mint (create) new tokens. Strongly Advised to set to false.
    allow_not_initialized: false, // This indicates whether the token account is properly set up on the blockchain. Strongly Advised to set to false
    allow_freeze_authority: false, // The freeze authority is the address that can freeze token transfers, effectively locking up funds. Strongly Advised to set to false
    allow_rugged: false,
    // Critical
    allow_mutable: false,
    block_returning_token_names: false,
    block_returning_token_creators: false,
    block_symbols: ["XXX"],
    block_names: ["XXX"],
    allow_insider_topholders: true, // Allow insider accounts to be part of the top holders
    max_alowed_pct_topholders: 5, // Max allowed percentage an individual top holder might hold
    exclude_lp_from_topholders: true, // If true, Liquidity Pools will not be seen as top holders
    // Warning
    min_total_markets: 1,
    min_total_lp_providers: 1,
    min_total_market_Liquidity: 35000,
    // Misc
    ignore_pump_fun: false,
    max_score: 11400, // Set to 0 to ignore
    max_token_age_minutes: 90, // Maximum age of token in minutes, 0 to ignore
    legacy_not_allowed: [
      "Low Liquidity",
      "Single holder ownership",
      "High holder concentration",
      "Freeze Authority still enabled",
      // "Large Amount of LP Unlocked",
      // "Copycat token",
      // "Low amount of LP Providers",
    ],
  },
  twitter_search: {
    minimum_tweets: 3,           // Minimum number of tweets needed
    minimum_unique_authors: 3,   // Minimum number of different authors needed
    maximum_tweet_age_minutes: 30, // Maximum age of tweets to consider
    max_token_age_minutes: 40,    // Maximum age of token to consider
    excluded_users: [            // List of users to exclude from tweet counts
      "pump_detector",
      "BondedPump",
      "rugpulldetector",
      "tokensniffer",
      "cryptoscamfinder",
      "SolDeckBot",
      "PumpFunScanner",
      "solmemescope",
      "yutibot2",
      "kuzkrypto",
      "pumperius",
      "secretdegens_",
      "alexeya76698",
      "testzentrumb",
      "layzrd",
      "ronaldosnapchat",
      "cryptoclawws",
      "alfred_ara59853",
      "__aminamu_",
      "__justbenneto_",
      "___psalmsoleth_",
      "owrcp38220"
    ],
    matched_users: [           // List of important users - their tweets trigger immediate notification
      "jxshujuxihu1",
      "criptosonia_",
      "mx_qh90936",
      "DesireKeac21062",
      "nicoscalls",      
      "realgmarik",
      "neim_on_x"
    ],
    blacklisted_users: [      // List of Twitter users whose tokens we don't want to buy
      "kolkerwesl51705",
      
    ]
  },
  helius: {
    // Add your Helius configuration here
  }
};
