const express = require('express');
const { Pool } = require('pg');
const path = require('path'); 
const app = express();
const port = 9999;

// PostgreSQL pool configuration
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: '@AdminYokie',
    port: 5432,
});

// Serve static files from 'public'
app.use(express.static('public'));

// Middleware to parse JSON bodies
app.use(express.json());

// Route to serve search.html
app.get('/search', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'search.html'));
});

// Route to handle search request
app.post('/search', (req, res) => {
  const { barcodeid } = req.body;
  
  // Check each component table for the given barcode
  const queryPRBC = `SELECT * FROM prbc WHERE barcodeid = $1`;
  const queryPC = `SELECT * FROM pc WHERE barcodeid = $1`;
  const queryPlasma = `SELECT * FROM plasma WHERE barcodeid = $1`;

  Promise.all([
    pool.query(queryPRBC, [barcodeid]),
    pool.query(queryPC, [barcodeid]),
    pool.query(queryPlasma, [barcodeid])
  ])
  .then(results => {
    const prbc = results[0].rows.length > 0 ? results[0].rows[0] : null;
    const pc = results[1].rows.length > 0 ? results[1].rows[0] : null;
    const plasma = results[2].rows.length > 0 ? results[2].rows[0] : null;

    res.json({ prbc, pc, plasma });
  })
  .catch(error => {
    console.error('Error fetching data:', error);
    res.status(500).json({ error: 'Database query error' });
  });
});

// Start the server
app.listen(port, () => {
  console.log(`Server running on http://localhost:${port}`);
});
