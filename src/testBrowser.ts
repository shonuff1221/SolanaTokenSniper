import puppeteer, { Browser, Page } from 'puppeteer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

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
    private lastActivityTime: number = Date.now();
    private inactivityTimeout: number = 3 * 60 * 1000; // 3 minutes
    private checkInterval: NodeJS.Timeout | null = null;
    private isClosing: boolean = false;

    async initialize(): Promise<void> {
        if (this.browser) return;

        console.log('Launching browser...');
        this.browser = await puppeteer.launch({
            headless: true,
            args: ['--no-sandbox']
        });

        // Start inactivity checker
        this.checkInterval = setInterval(() => this.checkInactivity(), 30000); // Check every 30 seconds
    }

    private async checkInactivity(): Promise<void> {
        if (!this.browser || this.isClosing) return;

        const timeSinceLastActivity = Date.now() - this.lastActivityTime;
        if (timeSinceLastActivity >= this.inactivityTimeout) {
            console.log('Browser inactive for 3 minutes, closing...');
            await this.close();
        }
    }

    async searchToken(tokenAddress: string): Promise<void> {
        if (!this.browser || this.isClosing) {
            throw new Error('Browser is not initialized or is closing');
        }

        this.lastActivityTime = Date.now();
        let page: Page | null = null;

        try {
            console.log(`\nSearching X for token: ${tokenAddress}`);
            page = await this.navigateToTwitterSearch(tokenAddress);

            // Wait for tweets with retry
            let tweetsLoaded = false;
            let retryCount = 0;
            const maxRetries = 3;
            const waitTime = 30000;

            while (!tweetsLoaded && retryCount < maxRetries) {
                try {
                    await page.waitForSelector('article[data-testid="tweet"]', { timeout: waitTime });
                    tweetsLoaded = true;
                } catch {
                    console.log(`Attempt ${retryCount + 1}/${maxRetries}: Waiting for tweets to load...`);
                    retryCount++;
                    if (retryCount === maxRetries) {
                        throw new Error('Failed to load tweets after multiple attempts');
                    }
                    await delay(5000);
                }
            }

            // Extract tweets
            const tweets = await page.$$eval('article[data-testid="tweet"]', (articles) => {
                return articles.map(article => {
                    const timeElement = article.querySelector('time');
                    const timestamp = timeElement ? timeElement.getAttribute('datetime') : '';
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
            });

            // Filter recent tweets
            const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);
            const recentTweets = tweets.filter(tweet => {
                if (!tweet.timestamp) return false;
                const tweetDate = new Date(tweet.timestamp);
                return tweetDate > tenMinutesAgo;
            });

            // Save tweets to JSON file
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const outputFile = path.join(process.cwd(), 'data', `tweets-${tokenAddress}-${timestamp}.json`);
            
            // Ensure data directory exists
            const dataDir = path.join(process.cwd(), 'data');
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            fs.writeFileSync(outputFile, JSON.stringify({
                tokenAddress,
                searchTime: new Date().toISOString(),
                timeWindow: '10 minutes',
                tweetCount: recentTweets.length,
                tweets: recentTweets
            }, null, 2));

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
            
            // Reset activity timer
            this.lastActivityTime = Date.now();
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

    async close(): Promise<void> {
        if (this.isClosing) return;

        this.isClosing = true;
        console.log('Closing browser manager...');

        if (this.checkInterval) {
            clearInterval(this.checkInterval);
            this.checkInterval = null;
        }

        if (this.browser) {
            try {
                const pages = await this.browser.pages();
                await Promise.all(pages.map(page => page.close().catch(console.error)));
                await this.browser.close();
                this.browser = null;
                console.log('Browser closed successfully');
            } catch (error) {
                console.error('Error closing browser:', error);
            }
        }

        this.isClosing = false;
    }
}

// Example usage
async function main() {
    const browserManager = new BrowserManager();
    await browserManager.initialize();

    // You can now use browserManager.searchToken() multiple times
    // The browser will stay open until 3 minutes of inactivity
    
    // Example:
    try {
        await browserManager.searchToken("7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU");
        // You can search for more tokens here...
    } catch (error) {
        console.error('Error in main:', error);
    }
}

if (require.main === module) {
    main().catch(console.error);
}

export { BrowserManager };
