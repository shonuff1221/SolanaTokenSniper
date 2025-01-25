import puppeteer, { Browser, Page } from 'puppeteer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

interface Tweet {
    text: string;
    timestamp: string;
    author: string;
}

// Function to load cookies if they exist
async function loadCookies(page: Page): Promise<boolean> {
    try {
        const cookiesPath = path.join(process.cwd(), 'twitter-cookies.json');
        if (fs.existsSync(cookiesPath)) {
            const cookiesString = fs.readFileSync(cookiesPath, 'utf8');
            const cookies = JSON.parse(cookiesString);
            await page.setCookie(...cookies);
            console.log('Loaded existing Twitter cookies');
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
        const cookies = await page.cookies();
        const cookiesPath = path.join(process.cwd(), 'twitter-cookies.json');
        fs.writeFileSync(cookiesPath, JSON.stringify(cookies, null, 2));
        console.log('Saved Twitter cookies for future use');
    } catch (error) {
        console.error('Error saving cookies:', error);
    }
}

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

async function setupPage(browser: Browser, retries = 3): Promise<Page> {
    for (let i = 0; i < retries; i++) {
        try {
            const page = await browser.newPage();
            await page.setDefaultNavigationTimeout(60000);
            await page.setDefaultTimeout(60000);
            await page.setViewport({ width: 1280, height: 800 });
            return page;
        } catch (error) {
            console.error(`Failed to create page, attempt ${i + 1} of ${retries}`);
            if (i === retries - 1) throw error;
            await delay(1000);
        }
    }
    throw new Error('Failed to create page after multiple attempts');
}

async function loginToTwitter(page: Page): Promise<boolean> {
    try {
        console.log('Attempting to log in to Twitter...');
        
        // Go to login page and wait for it to load
        await page.goto('https://twitter.com/i/flow/login', {
            waitUntil: 'networkidle0',
            timeout: 30000
        });
        await delay(3000);
        
        // Take screenshot of initial page
        console.log('Taking screenshot of login page...');
        await page.screenshot({ path: 'login-page.png' });

        console.log('Waiting for username field...');
        // Wait for and type username
        await page.waitForSelector('input[autocomplete="username"]', { visible: true, timeout: 10000 });
        const usernameInput = await page.$('input[autocomplete="username"]');
        if (!usernameInput) {
            console.log('Username input not found, taking screenshot...');
            await page.screenshot({ path: 'username-not-found.png' });
            throw new Error('Username input not found');
        }
        
        await usernameInput.click({ clickCount: 3 }); // Select all text
        await usernameInput.press('Backspace'); // Clear any existing text
        await usernameInput.type(process.env.TWITTER_USERNAME || '', { delay: 100 });
        console.log('Username entered');
        
        // Screenshot after entering username
        console.log('Taking screenshot after entering username...');
        await page.screenshot({ path: 'username-entered.png' });
        
        // Find and click the Next button
        const nextButton = await page.waitForSelector('div[role="button"]:has-text("Next")', { visible: true });
        if (!nextButton) {
            console.log('Next button not found, taking screenshot...');
            await page.screenshot({ path: 'next-button-not-found.png' });
            throw new Error('Next button not found');
        }
        await nextButton.click();
        await delay(2000);
        
        // Screenshot after clicking next
        console.log('Taking screenshot after clicking next...');
        await page.screenshot({ path: 'after-next-click.png' });
        
        console.log('Waiting for password field...');
        // Wait for and type password
        await page.waitForSelector('input[name="password"]', { visible: true, timeout: 10000 });
        const passwordInput = await page.$('input[name="password"]');
        if (!passwordInput) {
            console.log('Password input not found, taking screenshot...');
            await page.screenshot({ path: 'password-not-found.png' });
            throw new Error('Password input not found');
        }
        
        await passwordInput.click({ clickCount: 3 }); // Select all text
        await passwordInput.press('Backspace'); // Clear any existing text
        await passwordInput.type(process.env.TWITTER_PASSWORD || '', { delay: 100 });
        console.log('Password entered');
        
        // Screenshot after entering password
        console.log('Taking screenshot after entering password...');
        await page.screenshot({ path: 'password-entered.png' });
        
        // Find and click the Login button
        const loginButton = await page.waitForSelector('div[role="button"]:has-text("Log in")', { visible: true });
        if (!loginButton) {
            console.log('Login button not found, taking screenshot...');
            await page.screenshot({ path: 'login-button-not-found.png' });
            throw new Error('Login button not found');
        }
        await loginButton.click();
        
        // Wait for login to complete
        console.log('Waiting for login to complete...');
        await delay(5000);
        
        // Final screenshot
        console.log('Taking final screenshot...');
        await page.screenshot({ path: 'final-state.png' });
        
        // Check if login was successful
        const currentUrl = await page.url();
        if (currentUrl.includes('twitter.com/home')) {
            console.log('Login successful!');
            await saveCookies(page);
            return true;
        } else {
            console.log('Login might have failed. Current URL:', currentUrl);
            return false;
        }
    } catch (error) {
        console.error('Error during login:', error);
        // Take a screenshot to debug
        try {
            console.log('Taking error screenshot...');
            await page.screenshot({ path: 'login-error.png' });
            console.log('Screenshot saved as login-error.png');
        } catch (screenshotError) {
            console.error('Failed to save error screenshot:', screenshotError);
        }
        return false;
    }
}

async function navigateToTwitterSearch(page: Page, tokenAddress: string, retries = 3): Promise<void> {
    // First try to load existing cookies
    const hasCookies = await loadCookies(page);
    
    if (!hasCookies) {
        console.log('No existing cookies found. Need to login first.');
        const loginSuccess = await loginToTwitter(page);
        if (!loginSuccess) {
            throw new Error('Failed to login to Twitter');
        }
    }

    const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(tokenAddress)}&f=live`;
    
    for (let i = 0; i < retries; i++) {
        try {
            console.log(`Navigating to: ${searchUrl}`);
            await page.goto(searchUrl, { 
                waitUntil: 'networkidle0',
                timeout: 60000 
            });
            
            // Verify we're not redirected to login
            const currentUrl = await page.url();
            if (currentUrl.includes('/login')) {
                console.log('Redirected to login. Attempting to login...');
                const loginSuccess = await loginToTwitter(page);
                if (!loginSuccess) {
                    throw new Error('Failed to login to Twitter');
                }
                // Retry the search after login
                await page.goto(searchUrl, { waitUntil: 'networkidle0' });
            }
            
            await delay(2000);
            return;
        } catch (error) {
            console.error(`Navigation failed, attempt ${i + 1} of ${retries}:`, error);
            if (i === retries - 1) throw error;
            await delay(2000);
        }
    }
    throw new Error('Failed to navigate after multiple attempts');
}

async function testBrowser(tokenAddress: string = "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU") {
    let browser: Browser | null = null;
    let page: Page | null = null;

    try {
        console.log('Launching browser...');
        browser = await puppeteer.connect({
            browserWSEndpoint: `https://browserless.app.ejm.services?token=${process.env.BROWSERLESS_TOKEN}`,
            defaultViewport: null,
            protocolTimeout: 60000
        });

        console.log('Setting up page...');
        page = await setupPage(browser);
        
        // Take screenshot after page setup
        console.log('Taking screenshot after page setup...');
        await page.screenshot({ path: 'page-setup.png' });

        // Search parameters
        const waitTime = 30000;  // Increased wait time
        const tenMinutesAgo = new Date(Date.now() - 10 * 60 * 1000);

        console.log(`Searching Twitter for token: ${tokenAddress}`);
        await navigateToTwitterSearch(page, tokenAddress);
        
        // Take screenshot after navigation starts
        console.log('Taking screenshot after starting Twitter search...');
        await page.screenshot({ path: 'twitter-search-start.png' });

        // Wait for tweets with retry
        let tweetsLoaded = false;
        for (let i = 0; i < 3; i++) {
            try {
                await page.waitForSelector('article[data-testid="tweet"]', { timeout: waitTime });
                tweetsLoaded = true;
                break;
            } catch (error) {
                console.log(`Attempt ${i + 1}: Waiting for tweets to load...`);
                if (i === 2) throw error;
                await delay(2000);
            }
        }

        if (!tweetsLoaded) {
            throw new Error('No tweets found after multiple attempts');
        }

        // Collect tweets
        const tweets: Tweet[] = [];
        let lastTweetsCount = 0;
        let shouldContinue = true;
        let scrollAttempts = 0;
        const maxScrollAttempts = 10;

        while (shouldContinue && scrollAttempts < maxScrollAttempts) {
            try {
                const newTweets = await page.evaluate(() => {
                    const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
                    return Array.from(tweetElements).map(tweet => ({
                        text: tweet.querySelector('[data-testid="tweetText"]')?.textContent || '',
                        timestamp: tweet.querySelector('time')?.getAttribute('datetime') || '',
                        author: tweet.querySelector('[data-testid="User-Name"]')?.textContent || '',
                    }));
                });

                // Process only new tweets
                for (const tweet of newTweets.slice(lastTweetsCount)) {
                    const tweetDate = new Date(tweet.timestamp);
                    
                    if (tweetDate < tenMinutesAgo) {
                        shouldContinue = false;
                        break;
                    }

                    tweets.push(tweet);
                    console.log('\nNew Tweet Found:');
                    console.log('Author:', tweet.author);
                    console.log('Time:', tweet.timestamp);
                    console.log('Text:', tweet.text);
                    console.log('-'.repeat(50));
                }

                if (!shouldContinue || newTweets.length === lastTweetsCount) {
                    break;
                }

                lastTweetsCount = newTweets.length;
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await delay(1000);
                scrollAttempts++;

            } catch (error) {
                console.error('Error during tweet collection:', error);
                break;
            }
        }

        console.log(`\nFound ${tweets.length} tweets in the last 10 minutes.`);

        // Save tweets to JSON file
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        const outputDir = path.join(process.cwd(), 'data');
        if (!fs.existsSync(outputDir)) {
            fs.mkdirSync(outputDir);
        }
        
        const outputFile = path.join(outputDir, `tweets_${tokenAddress}_${timestamp}.json`);
        fs.writeFileSync(outputFile, JSON.stringify({
            tokenAddress,
            searchTime: new Date().toISOString(),
            timeWindow: '10 minutes',
            tweetCount: tweets.length,
            tweets
        }, null, 2));

        console.log(`Tweets saved to: ${outputFile}`);

    } catch (error) {
        console.error('Error:', error);
    } finally {
        if (page) {
            try {
                await page.close();
            } catch (error) {
                console.error('Error closing page:', error);
            }
        }
        if (browser) {
            try {
                await browser.close();
                console.log('Browser closed successfully');
            } catch (error) {
                console.error('Error closing browser:', error);
            }
        }
    }
}

// Get token address from command line argument or use default
const tokenAddress = process.argv[2] || "7xKXtg2CW87d97TXJSDpbD5jBkheTqA83TZRuJosgAsU";
testBrowser(tokenAddress);
