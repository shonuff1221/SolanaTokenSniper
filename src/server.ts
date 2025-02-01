/* eslint-disable @typescript-eslint/no-unused-vars */
import express from 'express';
import { initDB, getTopTokensByPrice } from './db/tokenDB';

const app = express();
const port = 3000;

// Serve static files from public directory
app.use(express.static('public'));

// Set EJS as the view engine
app.set('view engine', 'ejs');
app.set('views', './views');

app.get('/top-tokens', async (req, res) => {
    try {
        const tokens = await getTopTokensByPrice(10);
        res.render('tokens', { tokens });
    } catch (error) {
        res.status(500).send('Error fetching tokens');
    }
});

// API endpoint for getting token data as JSON
app.get('/api/top-tokens', async (req, res) => {
    try {
        const tokens = await getTopTokensByPrice(10);
        res.json(tokens);
    } catch (error) {
        res.status(500).json({ error: 'Error fetching tokens' });
    }
});

export async function startServer(): Promise<void> {
    // Initialize database
    await initDB();
    
    // Start server
    app.listen(port, () => {
        console.log(`🌐 Token display server running at http://localhost:${port}/top-tokens`);
    });
}
