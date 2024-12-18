export const config = {
  liquidity_pool: {
    ignore_pump_fun: true,
    radiyum_program_id: "675kPX9MHTjS2zt1qfr1NYHuzeLXfQM9H24wFSUt1Mp8",
    wsol_pc_mint: "So11111111111111111111111111111111111111112",
  },
  tx: {
    get_retry_interval: 750, // Amount of seconds to trigger transaction details request
    get_retry_timeout: 20000, // Amount of seconds to keep trying to fetch transaction details
    get_timeout: 10000, // Timeout for API requests
  },
  swap: {
    prio_fee_max_lamports: 1000000, // 0.001 SOL
    prio_level: "veryHigh", // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
    amount: "10000000", //0.01 SOL
    slippageBps: "200", // 2%
    db_name_tracker_holdings: "src/tracker/holdings.db", // Sqlite Database location
  },
  sell: {
    prio_fee_max_lamports: 1000000, // 0.001 SOL
    prio_level: "veryHigh", // If you want to land transaction fast, set this to use `veryHigh`. You will pay on average higher priority fee.
    slippageBps: "200", // 2%
    auto_sell: false, // If set to true, stop loss and take profit triggers automatically when set.
    stop_loss_percent: 10,
    take_profit_percent: 10,
    track_public_wallet: "", // If set an additional log line will be shown with a link to track your wallet
  },
  rug_check: {
    single_holder_ownership: 30,
    not_allowed: ["Freeze Authority still enabled", "Large Amount of LP Unlocked", "Low amount of LP Providers", "Copycat token"],
  },
};
