import puppeteer, { Browser, Page } from 'puppeteer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';
import { sendTokenToGroup, initTelegram } from './telegram';

dotenv.config();

interface AccountsConfig {
    twitterAccounts: string[];
}

interface TokensConfig {
    tokens: {
        [key: string]: {
            firstSeenAt: string;
            tweetUrl: string;
            author: string;
        };
    };
}

interface Config {
    telegram: {
        enabled: boolean;
    };
}

// Function to load Twitter accounts from config file
function loadTwitterAccounts(): string[] {
    try {
        const configPath = path.join(__dirname, 'config', 'accounts.json');
        if (!fs.existsSync(configPath)) {
            console.warn('⚠️ accounts.json not found, creating default config...');
            const defaultConfig: AccountsConfig = {
                twitterAccounts: ['solana', 'solanacookbook']
            };
            fs.mkdirSync(path.join(__dirname, 'config'), { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4));
            return defaultConfig.twitterAccounts;
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as AccountsConfig;
        console.log('✅ Loaded Twitter accounts from config:', config.twitterAccounts);
        return config.twitterAccounts;
    } catch (error) {
        console.error('❌ Error loading Twitter accounts:', error);
        return ['solana']; // Return default account if there's an error
    }
}

// Function to check if token has been found before
function isTokenFound(tokenAddress: string): boolean {
    try {
        const configPath = path.join(__dirname, 'config', 'found_tokens.json');
        if (!fs.existsSync(configPath)) {
            return false;
        }
        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as TokensConfig;
        return !!config.tokens[tokenAddress];
    } catch (error) {
        console.error('❌ Error checking token status:', error);
        return false;
    }
}

// Function to save found token
function saveFoundToken(tokenAddress: string, tweetUrl: string, author: string): void {
    try {
        const configPath = path.join(__dirname, 'config', 'found_tokens.json');
        let config: TokensConfig = { tokens: {} };
        
        if (fs.existsSync(configPath)) {
            config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as TokensConfig;
        }

        if (!config.tokens[tokenAddress]) {
            config.tokens[tokenAddress] = {
                firstSeenAt: new Date().toISOString(),
                tweetUrl,
                author
            };
            fs.writeFileSync(configPath, JSON.stringify(config, null, 4));
            console.log('✅ Saved new token to found_tokens.json:', tokenAddress);
        }
    } catch (error) {
        console.error('❌ Error saving found token:', error);
    }
}

// Function to load cookies if they exist
async function loadCookies(page: Page): Promise<boolean> {
    try {
        const cookiesPath = path.join(process.cwd(), 'x-cookies.json');
        if (fs.existsSync(cookiesPath)) {
            const cookiesString = fs.readFileSync(cookiesPath, 'utf8');
            const cookies = JSON.parse(cookiesString);
            await page.browser().setCookie(...cookies);
            console.log('Loaded x cookies');
            return true;
        }
    } catch (error) {
        console.error('Error loading cookies:', error);
    }
    return false;
}

// Function to save cookies for future use
async function saveCookies(page: Page) {
    try {
        const cookies = await page.browser().cookies();
        const cookiesPath = path.join(process.cwd(), 'x-cookies.json');
        fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
        console.log('Saved X cookies for future use');
    } catch (error) {
        console.error('Error saving cookies:', error);
    }
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

// Function to delay with exponential backoff
async function delayWithBackoff(retryCount: number): Promise<void> {
    const baseDelay = 2000; // 2 seconds base
    const maxDelay = 30000; // 30 seconds max
    const delay = Math.min(baseDelay * Math.pow(2, retryCount), maxDelay);
    await new Promise(resolve => setTimeout(resolve, delay));
}

// Function to login to Twitter
async function loginToTwitter(page: Page): Promise<boolean> {
    try {
        console.log('Attempting to log in to x...');
        
        // Go to login page and wait for it to load
        await page.goto('https://x.com/i/flow/login', {
            waitUntil: 'networkidle2', 
            timeout: 60000 
        });
        await delay(5000);
        
        console.log('Waiting for username field...');
        // Wait for and type username
        const usernameSelector = 'input[autocomplete="username"]';
        await page.waitForSelector(usernameSelector, { visible: true, timeout: 20000 });
        
        // Ensure the page is stable before proceeding
        await delay(2000);
        
        const usernameInput = await page.$(usernameSelector);
        if (!usernameInput) {
            throw new Error('Username input not found');
        }
        
        // Clear and type username with retry logic
        let retries = 3;
        while (retries > 0) {
            try {
                await usernameInput.click({ clickCount: 3 });
                await usernameInput.press('Backspace');
                await usernameInput.type(process.env.TWITTER_USERNAME || '', { delay: 100 });
                console.log('Username entered');
                break;
            } catch (error) {
                console.error(`Failed to enter username, retries left: ${retries - 1}`);
                retries--;
                if (retries === 0) throw error;
                await delay(1000);
            }
        }
        
        await delay(2000);
        
        // Find and click the Next button
        const nextButtonSelector = 'div[role="button"]:has-text("Next")';
        const nextButton = await page.waitForSelector(nextButtonSelector, { visible: true, timeout: 10000 });
        if (!nextButton) {
            throw new Error('Next button not found');
        }
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 20000 }).catch(() => {}),
            nextButton.click()
        ]);
        
        await delay(3000);
        
        console.log('Waiting for password field...');
        const passwordSelector = 'input[name="password"]';
        await page.waitForSelector(passwordSelector, { visible: true, timeout: 20000 });
        
        // Ensure the page is stable before proceeding
        await delay(2000);
        
        const passwordInput = await page.$(passwordSelector);
        if (!passwordInput) {
            throw new Error('Password input not found');
        }
        
        // Clear and type password with retry logic
        retries = 3;
        while (retries > 0) {
            try {
                await passwordInput.click({ clickCount: 3 });
                await passwordInput.press('Backspace');
                await passwordInput.type(process.env.TWITTER_PASSWORD || '', { delay: 100 });
                console.log('Password entered');
                break;
            } catch (error) {
                console.error(`Failed to enter password, retries left: ${retries - 1}`);
                retries--;
                if (retries === 0) throw error;
                await delay(1000);
            }
        }
        
        await delay(2000);
        
        // Find and click the Login button
        const loginButtonSelector = 'div[role="button"]:has-text("Log in")';
        const loginButton = await page.waitForSelector(loginButtonSelector, { visible: true, timeout: 10000 });
        if (!loginButton) {
            throw new Error('Login button not found');
        }
        
        await Promise.all([
            page.waitForNavigation({ waitUntil: 'networkidle2', timeout: 30000 }).catch(() => {}),
            loginButton.click()
        ]);
        
        // Increased wait time after login
        await delay(8000);
        
        // Check if login was successful
        const currentUrl = await page.url();
        if (currentUrl.includes('x.com/home')) {
            console.log('Login successful!');
            await saveCookies(page);
            return true;
        } else {
            console.log('Login might have failed. Current URL:', currentUrl);
            return false;
        }
    } catch (error) {
        console.error('Error during login:', error);
        return false;
    }
}

class BrowserManager {
    private browser: Browser | null = null;
    private isClosing: boolean = false;
    private lastScannedTweets: Map<string, string> = new Map(); // Store last seen tweet IDs
    private accountPages: Map<string, Page> = new Map(); // Store open tabs for each account

    async initialize(): Promise<void> {
        if (this.browser) return;

        console.log('🔄 Initializing browser...');
        try {
            this.browser = await puppeteer.launch({
                headless: true,
                args: ['--no-sandbox', '--disable-setuid-sandbox']
            });
            console.log('✅ Browser initialized');

            // Initialize tabs for all accounts
            const monitoredAccounts = loadTwitterAccounts();
            for (const account of monitoredAccounts) {
                const page = await this.browser.newPage();
                await loadCookies(page);
                this.accountPages.set(account, page);
                console.log(`📱 Opened tab for @${account}`);
            }
        } catch (error) {
            console.error('❌ Failed to initialize browser:', error);
            throw error;
        }
    }

    async close(): Promise<void> {
        if (this.isClosing) return;

        this.isClosing = true;
        console.log('Closing browser manager...');
        
        // Close all account pages
        for (const [account, page] of this.accountPages) {
            try {
                await page.close();
                console.log(`📴 Closed tab for @${account}`);
            } catch (error) {
                console.error(`❌ Error closing tab for @${account}:`, error);
            }
        }
        this.accountPages.clear();

        if (this.browser) {
            await this.browser.close();
            this.browser = null;
        }
        
        this.isClosing = false;
    }

    async scanAccountTweets(): Promise<void> {
        if (!this.browser) {
            await this.initialize();
        }

        try {
            const monitoredAccounts = loadTwitterAccounts();
            console.log(`🔄 Starting scan for ${monitoredAccounts.length} accounts...`);

            // Scan all accounts in parallel
            await Promise.all(monitoredAccounts.map(async (account) => {
                let retryCount = 0;
                const maxRetries = 3;

                // Get or create page for this account
                let page = this.accountPages.get(account);
                if (!page) {
                    page = await this.browser!.newPage();
                    await loadCookies(page);
                    this.accountPages.set(account, page);
                    console.log(`📱 Created new tab for @${account}`);
                }

                while (retryCount < maxRetries) {
                    try {
                        await page.goto(`https://twitter.com/${account}`, {
                            waitUntil: 'networkidle2',
                            timeout: 30000
                        });

                        // Add small random delay
                        await delay(1000 + Math.random() * 1000);

                        // Check for rate limit indicators
                        const rateLimitSelector = 'div[data-testid="empty_state_header_text"]';
                        const isRateLimited = await page.$(rateLimitSelector).then(el => !!el);

                        if (isRateLimited) {
                            console.log(`⚠️ Rate limit detected for @${account}, will retry after delay...`);
                            await delayWithBackoff(retryCount);
                            retryCount++;
                            continue;
                        }

                        // Wait for tweets to load
                        const tweetSelector = 'article[data-testid="tweet"]';
                        await page.waitForSelector(tweetSelector, { timeout: 30000 });

                        // Get tweets
                        const tweets = await page.$$eval(tweetSelector, (elements) => {
                            return elements.slice(0, 5).map((tweet) => {
                                const textElement = tweet.querySelector('[data-testid="tweetText"]');
                                const timestampElement = tweet.querySelector('time');
                                const tweetId = tweet.getAttribute('data-tweet-id');
                                const tweetUrl = tweet.querySelector('a[href*="/status/"]')?.getAttribute('href') || '';
                                
                                return {
                                    text: textElement ? textElement.textContent : '',
                                    timestamp: timestampElement ? timestampElement.getAttribute('datetime') : '',
                                    id: tweetId || '',
                                    url: tweetUrl
                                };
                            });
                        });

                        // Process each tweet
                        for (const tweet of tweets) {
                            if (!this.lastScannedTweets.has(tweet.id) && tweet.text) {
                                const tokenMatches = tweet.text.match(/[1-9A-HJ-NP-Za-km-z]{32,44}/g);
                                
                                if (tokenMatches) {
                                    for (const tokenAddress of tokenMatches) {
                                        if (!isTokenFound(tokenAddress)) {
                                            console.log(`💎 Found new token address in tweet from @${account}: ${tokenAddress}`);
                                            const tweetUrl = `https://twitter.com${tweet.url}`;
                                            saveFoundToken(tokenAddress, tweetUrl, account);
                                            await sendTokenToGroup(tokenAddress);
                                        }
                                    }
                                }

                                this.lastScannedTweets.set(tweet.id, tweet.timestamp || '');
                            }
                        }

                        break;

                    } catch (error) {
                        console.error(`❌ Error scanning tweets from @${account} (attempt ${retryCount + 1}/${maxRetries}):`, error);
                        
                        if (!page.isClosed()) {
                            try {
                                await page.reload({ waitUntil: 'networkidle2', timeout: 30000 });
                            } catch {
                                page = await this.browser!.newPage();
                                await loadCookies(page);
                                this.accountPages.set(account, page);
                                console.log(`📱 Created new tab for @${account} after error`);
                            }
                        }
                        
                        await delayWithBackoff(retryCount);
                        retryCount++;
                    }
                }
            }));

            console.log('✅ Completed scanning all accounts');

        } catch (error) {
            console.error('❌ Error in scanAccountTweets:', error);
        }
    }

    async searchToken(tokenAddress: string): Promise<{ text: string; timestamp: string; author: string; }[] | null> {
        if (!this.browser || this.isClosing) {
            throw new Error('Browser is not initialized or is closing');
        }

        let page: Page | null = null;

        try {
            console.log(`Searching X for token: ${tokenAddress}`);
            page = await this.navigateToTwitterSearch(tokenAddress);

            // Single attempt to find tweets
            try {
                await page.waitForSelector('article[data-testid="tweet"]', { timeout: 30000 });
            } catch {
                console.log('No tweets found for this token');
                return null;
            }

            // Extract tweets
            const tweets = await page.$$eval('article[data-testid="tweet"]', (articles) => {
                return articles.map(article => {
                    const timeElement = article.querySelector('time');
                    const timestamp = timeElement?.getAttribute('datetime') || '';
                    const text = article.textContent || '';
                    
                    const userNameElement = article.querySelector('[data-testid="User-Name"]');
                    let author = '';
                    if (userNameElement) {
                        const usernameLink = userNameElement.querySelector('a');
                        if (usernameLink) {
                            const href = usernameLink.getAttribute('href');
                            author = href ? href.split('/')[1] : '';
                        }
                    }

                    return { text, timestamp, author };
                });
            }).then(tweets => tweets.filter(tweet => tweet.timestamp && tweet.author));

            if (tweets.length === 0) {
                console.log('No valid tweets found after parsing');
                return null;
            }

            return tweets;

        } catch (error) {
            console.error('Error searching token:', error);
            throw error;
        } finally {
            if (page) {
                try {
                    await page.close();
                    console.log('Closed search page for token:', tokenAddress);
                } catch (error) {
                    console.error('Error closing page:', error);
                }
            }
        }
    }

    private async navigateToTwitterSearch(tokenAddress: string, retries = 3): Promise<Page> {
        if (!this.browser) throw new Error('Browser not initialized');

        let page = await this.browser.newPage();
        await page.setDefaultNavigationTimeout(60000);
        await page.setDefaultTimeout(60000);
        await page.setViewport({ width: 1280, height: 800 });
        
        // First try to load existing cookies
        const hasCookies = await loadCookies(page);
        
        if (!hasCookies) {
            console.log('No existing cookies found. Need to login first.');
            const loginSuccess = await loginToTwitter(page);
            if (!loginSuccess) {
                throw new Error('Failed to login to x');
            }
        }

        const searchUrl = `https://x.com/search?q=${encodeURIComponent(tokenAddress)}&f=live`;
        
        for (let i = 0; i < retries; i++) {
            try {
                console.log(`Navigating to: ${searchUrl}`);
                await page.goto(searchUrl, { 
                    waitUntil: 'networkidle2',
                    timeout: 60000 
                });
                
                // Verify we're not redirected to login
                const currentUrl = await page.url();
                if (currentUrl.includes('/login')) {
                    console.log('Redirected to login. Attempting to login...');
                    const loginSuccess = await loginToTwitter(page);
                    if (!loginSuccess) {
                        throw new Error('Failed to login to x');
                    }
                    await page.goto(searchUrl, { waitUntil: 'networkidle2' });
                }
                
                return page;
            } catch (error) {
                console.log(`Navigation failed, attempt ${i + 1} of ${retries}:`, error);
                
                if (i === retries - 1) {
                    throw error;
                }
                
                try {
                    await page.close();
                } catch (closeError) {
                    console.error('Error closing page:', closeError);
                }
                
                page = await this.browser.newPage();
                await page.setDefaultNavigationTimeout(60000);
                await page.setDefaultTimeout(60000);
                await page.setViewport({ width: 1280, height: 800 });
                await loadCookies(page);
                await delay(2000);
            }
        }
        
        throw new Error('Navigation failed after all retries');
    }
}

// Function to load main config
function loadConfig(): Config {
    try {
        const configPath = path.join(__dirname, 'config', 'config.json');
        if (!fs.existsSync(configPath)) {
            console.warn('config.json not found, creating default config...');
            const defaultConfig: Config = {
                telegram: {
                    enabled: true
                }
            };
            fs.mkdirSync(path.join(__dirname, 'config'), { recursive: true });
            fs.writeFileSync(configPath, JSON.stringify(defaultConfig, null, 4));
            return defaultConfig;
        }

        const config = JSON.parse(fs.readFileSync(configPath, 'utf8')) as Config;
        return config;
    } catch (error) {
        console.error('Error loading config:', error);
        return {
            telegram: {
                enabled: true
            }
        };
    }
}

// Modified main function
async function main() {
    const manager = new BrowserManager();
    const config = loadConfig();
    
    try {
        if (config.telegram.enabled) {
            console.log('🔄 Initializing Telegram...');
            await initTelegram();
            console.log('✅ Telegram initialized');
        } else {
            console.log('⚠️ Telegram notifications are disabled');
        }

        await manager.initialize();
        
        // Scan tweets every 15 seconds, but only one account at a time
        const scanInterval = 15 * 1000;
        
        while (true) {
            await manager.scanAccountTweets();
            console.log(`⏳ Waiting ${scanInterval/1000} seconds before next scan...`);
            await delay(scanInterval);
        }
    } catch (error) {
        console.error('❌ Error in main:', error);
        await manager.close();
    }
}

if (require.main === module) {
    main().catch(console.error);
}

export { BrowserManager };
