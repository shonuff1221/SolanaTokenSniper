import puppeteer, { Browser } from 'puppeteer';
import dotenv from 'dotenv';

dotenv.config();

interface ScraperConfig {
    browserlessUrl: string;
    browserlessToken: string;
    maxTweets?: number;
    waitTime?: number;
}

interface Tweet {
    text: string;
    timestamp: string;
    author: string;
}

class TwitterScraper {
    private browserlessUrl: string;
    private browserlessToken: string;
    private maxTweets: number;
    private waitTime: number;

    constructor(config: ScraperConfig) {
        this.browserlessUrl = config.browserlessUrl;
        this.browserlessToken = config.browserlessToken;
        this.maxTweets = config.maxTweets || 50;
        this.waitTime = config.waitTime || 5000;
    }

    async initialize(): Promise<Browser> {
        try {
            const wsEndpoint = `${this.browserlessUrl}?token=${this.browserlessToken}`;
            const browser = await puppeteer.connect({
                browserWSEndpoint: wsEndpoint,
            });
            return browser;
        } catch (error) {
            console.error('Failed to connect to browserless:', error);
            throw error;
        }
    }

    async searchTweets(tokenAddress: string): Promise<Tweet[]> {
        const browser = await this.initialize();
        const page = await browser.newPage();
        const tweets: Tweet[] = [];

        try {
            // Construct search URL for Twitter
            const searchUrl = `https://twitter.com/search?q=${encodeURIComponent(tokenAddress)}&f=live`;
            await page.goto(searchUrl, { waitUntil: 'networkidle0' });

            // Wait for tweets to load
            await page.waitForSelector('article[data-testid="tweet"]', { timeout: this.waitTime });

            // Scroll and collect tweets
            let lastTweetsCount = 0;
            while (tweets.length < this.maxTweets) {
                const newTweets = await page.evaluate(() => {
                    const tweetElements = document.querySelectorAll('article[data-testid="tweet"]');
                    return Array.from(tweetElements).map(tweet => ({
                        text: tweet.querySelector('[data-testid="tweetText"]')?.textContent || '',
                        timestamp: tweet.querySelector('time')?.getAttribute('datetime') || '',
                        author: tweet.querySelector('[data-testid="User-Name"]')?.textContent || '',
                    }));
                }) as Tweet[];

                tweets.push(...newTweets.slice(lastTweetsCount));
                
                if (tweets.length >= this.maxTweets || newTweets.length === lastTweetsCount) {
                    break;
                }

                lastTweetsCount = newTweets.length;
                await page.evaluate(() => window.scrollTo(0, document.body.scrollHeight));
                await new Promise(resolve => setTimeout(resolve, 1000));
            }

        } catch (error) {
            console.error('Error during scraping:', error);
            throw error;
        } finally {
            await browser.close();
        }

        return tweets.slice(0, this.maxTweets);
    }
}

// Example usage
async function main() {
    const scraper = new TwitterScraper({
        browserlessUrl: process.env.BROWSERLESS_URL || 'ws://localhost:3000',
        browserlessToken: process.env.BROWSERLESS_TOKEN || '',
    });

    try {
        const tokenAddress = process.argv[2];
        if (!tokenAddress) {
            console.error('Please provide a token address as an argument');
            process.exit(1);
        }

        console.log(`Searching tweets for token: ${tokenAddress}`);
        const tweets = await scraper.searchTweets(tokenAddress);
        console.log('Found tweets:', JSON.stringify(tweets, null, 2));
    } catch (error) {
        console.error('Error:', error);
    }
}

if (require.main === module) {
    main();
}

export { TwitterScraper };
