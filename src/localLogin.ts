import puppeteer, {  Page } from 'puppeteer';
import dotenv from 'dotenv';
import fs from 'fs';
import path from 'path';

dotenv.config();

async function delay(ms: number) {
    return new Promise(resolve => setTimeout(resolve, ms));
}

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

async function localLogin() {
    const browser = await puppeteer.launch({
        headless: false, // Show the browser
        defaultViewport: { width: 1280, height: 800 },
        args: ['--start-maximized']
    });

    try {
        const page = await browser.newPage();
        await page.setViewport({ width: 1280, height: 800 });

        // Navigate to Twitter login
        console.log('Going to X (Twitter) login page...');
        await page.goto('https://x.com/i/flow/login', {
            waitUntil: 'networkidle2',
            timeout: 60000
        });

        // Wait for manual login
        console.log('\nPlease login manually in the browser window.');
        console.log('The script will wait for you to complete the login process.');
        console.log('Once you see your X home feed, press Enter in this console...\n');

        // Wait for user input
        process.stdin.setRawMode(true);
        process.stdin.resume();
        process.stdin.setEncoding('utf8');
        
        await new Promise<void>(resolve => {
            process.stdin.on('data', (data: Buffer | string) => {
                const key = data.toString();
                if (key === '\r' || key === '\n') {
                    process.stdin.pause();
                    resolve();
                }
                // Press ctrl-c to exit
                if (key === '\u0003') {
                    process.exit();
                }
            });
        });

        // Verify login success
        const currentUrl = await page.url();
        if (currentUrl.includes('x.com/home') || currentUrl.includes('twitter.com/home')) {
            console.log('Successfully logged in!');
            await saveCookies(page);
            console.log('\nCookies have been saved to x-cookies.json');
            console.log('You can now use these cookies in your cloud deployment.');
        } else {
            console.log('Login seems to have failed. Current URL:', currentUrl);
        }

    } catch (error) {
        console.error('Error during login process:', error);
    } finally {
        await delay(2000); // Give a moment to see the final state
        await browser.close();
    }
}

// Run the login process
localLogin().catch(console.error);
