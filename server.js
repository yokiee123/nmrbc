const express = require('express');
const bodyParser = require('body-parser');
const path = require('path');
const { Pool } = require('pg'); // Use Pool instead of Client
const session = require('express-session');
const moment = require('moment'); // Add this line to import the moment library YOKIEEEE

const app = express();
const port = 3000;

// PostgreSQL pool configuration
const pool = new Pool({
    user: 'postgres', // replace with your PostgreSQL username
    host: 'localhost',
    database: 'postgres', // or your specific database name
    password: '@AdminYokie', // replace with your PostgreSQL password
    port: 5432,
});

// Middleware to parse URL-encoded bodies
app.use(bodyParser.urlencoded({ extended: true }));
app.use(bodyParser.json()); // To handle JSON requests

// Serve static files from the "public" directory
app.use(express.static(path.join(__dirname, 'public')));

// Set up session middleware
app.use(session({
    secret: 'your-secret-key', // Use a secure secret key
    resave: false,
    saveUninitialized: false
}));

// Route to serve login page
app.get('/login', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'login.html'));
});

// Handle login form submission
app.post('/login', (req, res) => {
    const { username, password } = req.body;

    if (username === 'admin' && password === 'admin') {
        req.session.loggedIn = true;
        res.redirect('/home.html');
    } else {
        res.send('<h1>Invalid credentials. Please <a href="/login">try again</a>.</h1>');
    }
});

// Middleware to protect routes
function checkAuth(req, res, next) {
    if (req.session.loggedIn) {
        next(); // User is authenticated, proceed to the next function
    } else {
        res.redirect('/login'); // User is not authenticated, redirect to login page
    }
}

// Protect the home route
app.get('/home.html', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'home.html'));
});

// Protect other routes
app.get('/search.html', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'search.html'));
});

app.get('/Transmittal.html', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'Transmittal.html'));
});

app.get('/worksheet.html', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'worksheet.html'));
});

app.get('/bloodtype.html', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'bloodtype.html'));
});

app.get('/screening.html', checkAuth, (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'screening.html'));
});


// Handle form submission (protected route)
app.post('/submit', checkAuth, async (req, res) => {
    try {
        const { barcodes, dates, components, volumes } = req.body;

        const barcodeArray = Array.isArray(barcodes) ? barcodes : [barcodes];
        const dateArray = Array.isArray(dates) ? dates : [dates];
        const componentArray = Array.isArray(components) ? components : [components];
        const volumeArray = Array.isArray(volumes) ? volumes : [volumes];

        let responseHtml = '<html><head><style>/* your styles here */</style></head><body>';

        for (let i = 0; i < barcodeArray.length; i++) {
            const barcodeID = barcodeArray[i];
            const dateCollection = dateArray[i];
            const volume = volumeArray[i];
            const component = componentArray[i];

            // Convert date to PostgreSQL format (YYYY-MM-DD)
            const formattedDate = moment(dateCollection, 'MM/DD/YYYY').format('YYYY-MM-DD');

            let table;
            switch (component) {
                case 'PRBC':
                    table = 'PRBC';
                    break;
                case 'PC':
                    table = 'PC';
                    break;
                case 'PLASMA':
                    table = 'PLASMA';
                    break;
                case 'WB':
                    table = 'WB';
                    break;
                case 'CRYO':
                    table = 'CRYO';
                    break;
                default:
                    continue; // Skip unknown components
            }

            // Check if barcode exists
            const { rowCount } = await pool.query(
                `SELECT 1 FROM ${table} WHERE BARCODEID = $1`,
                [barcodeID]
            );

            if (rowCount > 0) {
                // If barcode exists, return an error and stop further execution
                res.status(400).send(`
                <!DOCTYPE html>
                <html lang="en">
                <head>
                    <meta charset="UTF-8">
                    <meta name="viewport" content="width=device-width, initial-scale=1.0">
                    <title>Submission Error</title>
                    <style>
                        body {
                            background-color: #2c3e50; /* Dark theme */
                            color: #e74c3c; /* Red color for error */
                            font-family: Arial, sans-serif;
                            text-align: center;
                            padding: 50px;
                        }
                        .btn {
                            background-color: #c0392b; /* Red button */
                            color: white;
                            border: none;
                            padding: 10px 20px;
                            text-align: center;
                            font-size: 16px;
                            margin-top: 20px;
                            cursor: pointer;
                            border-radius: 5px;
                        }
                        .btn:hover {
                            background-color: #e74c3c; /* Lighter red on hover */
                        }
                    </style>
                </head>
                <body>
                    <h1>Submission Error</h1>
                    <p>Duplicate barcode ID ${barcodeID} found in table ${table}. Submission stopped.</p>
                    <button class="btn" onclick="window.history.back()">Go Back</button>
                </body>
                </html>
                `);
                return; // Exit the loop and stop further processing
            }

            // Insert if barcode does not exist
            await pool.query(
                `INSERT INTO ${table} (BARCODEID, Volume, DateCollection) VALUES ($1, $2, $3)`,
                [barcodeID, volume, formattedDate]
            );
            responseHtml += `<p>Inserted barcode ${barcodeID} into ${table}</p>`;
        }

        // After all successful inserts, send the final response
        responseHtml += `
        <!DOCTYPE html>
        <html lang="en">
        <head>
            <meta charset="UTF-8">
            <meta name="viewport" content="width=device-width, initial-scale=1.0">
            <title>Submission Complete</title>
            <style>
                body {
                    background-color: #2c3e50; /* Dark theme */
                    color: #ecf0f1; /* Light text for contrast */
                    font-family: Arial, sans-serif;
                    text-align: center;
                    padding: 50px;
                }
                .btn {
                    background-color: #16a085; /* Greenish button */
                    color: white;
                    border: none;
                    padding: 10px 20px;
                    text-align: center;
                    font-size: 16px;
                    margin-top: 20px;
                    cursor: pointer;
                    border-radius: 5px;
                }
                .btn:hover {
                    background-color: #1abc9c; /* Lighter green on hover */
                }
            </style>
        </head>
        <body>
            <h1>Submission Complete</h1>
            <p>Data submission completed successfully.</p>
            <button class="btn" onclick="window.history.back()">Go Back</button>
        </body>
        </html>`;

        res.status(200).send(responseHtml);  // Ensure response is sent

    } catch (error) {
        console.error('Error during submission:', error);
        res.status(500).send('An error occurred during submission: ' + error.message);
    }
});



// Route to handle barcode search for blood typing
app.post('/search', async (req, res) => {
    const { barcode } = req.body;

    try {
        const prbcResult = await pool.query('SELECT * FROM prbc WHERE barcodeid = $1', [barcode]);
        const pcResult = await pool.query('SELECT * FROM pc WHERE barcodeid = $1', [barcode]);
        const plasmaResult = await pool.query('SELECT * FROM plasma WHERE barcodeid = $1', [barcode]);

        if (prbcResult.rows.length === 0 && pcResult.rows.length === 0 && plasmaResult.rows.length === 0) {
            return res.json({ error: 'No records found for this barcode.' });
        }

        res.json({
            prbc: prbcResult.rows[0] || null,
            pc: pcResult.rows[0] || null,
            plasma: plasmaResult.rows[0] || null
        });
    } catch (error) {
        console.error('Error searching barcode:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Route to handle blood type submission for multiple tables
app.post('/addBloodType', async (req, res) => {
    const { barcode, bloodtype, rh } = req.body;

    try {
        const updatePRBC = 'UPDATE prbc SET bt = $1, rh = $2 WHERE barcodeid = $3';
        const prbcResult = await pool.query(updatePRBC, [bloodtype, rh, barcode]);

        const updatePC = 'UPDATE pc SET bt = $1, rh = $2 WHERE barcodeid = $3';
        const pcResult = await pool.query(updatePC, [bloodtype, rh, barcode]);

        const updatePLASMA = 'UPDATE plasma SET bt = $1, rh = $2 WHERE barcodeid = $3';
        const plasmaResult = await pool.query(updatePLASMA, [bloodtype, rh, barcode]);

        if (prbcResult.rowCount > 0 || pcResult.rowCount > 0 || plasmaResult.rowCount > 0) {
            res.json({ success: true, message: 'Blood type and Rh type updated successfully in all tables.' });
        } else {
            res.json({ success: false, message: 'No rows updated. Barcode not found.' });
        }
    } catch (error) {
        console.error('Error updating blood type:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Function to update screening results in a table
const updateScreeningResults = async (tableName, barcodeid, hcv, syphilis, hbsag, hiv, malaria) => {
    const query = `
        UPDATE ${tableName}
        SET HCV = $1, Syphilis = $2, HBsAg = $3, HIV = $4, Malaria = $5
        WHERE barcodeid = $6;
    `;
    await pool.query(query, [hcv, syphilis, hbsag, hiv, malaria, barcodeid]);
};

// Handle screening form submission
app.post('/submitScreening', async (req, res) => {
    const { barcode, hcv, syphilis, hbsag, hiv, malaria } = req.body;

    try {
        const prbcUpdateResult = await pool.query(`
            UPDATE prbc 
            SET hcv = $1, syphilis = $2, hbsag = $3, hiv = $4, malaria = $5
            WHERE barcodeid = $6
        `, [hcv, syphilis, hbsag, hiv, malaria, barcode]);

        const pcUpdateResult = await pool.query(`
            UPDATE pc 
            SET hcv = $1, syphilis = $2, hbsag = $3, hiv = $4, malaria = $5
            WHERE barcodeid = $6
        `, [hcv, syphilis, hbsag, hiv, malaria, barcode]);

        const plasmaUpdateResult = await pool.query(`
            UPDATE plasma 
            SET hcv = $1, syphilis = $2, hbsag = $3, hiv = $4, malaria = $5
            WHERE barcodeid = $6
        `, [hcv, syphilis, hbsag, hiv, malaria, barcode]);

        res.json({ success: true, message: 'Screening results updated successfully.' });
    } catch (error) {
        console.error('Error updating screening results:', error);
        res.status(500).json({ error: 'Internal server error: ' + error.message });
    }
});

// Start the server
app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
});
