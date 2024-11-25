const express = require('express');
const path = require('path'); // Added 'path' for handling file paths
const fs = require('fs'); // Added 'fs' for file operations like unlink
const { Pool } = require('pg');
const XLSX = require('xlsx'); // Added 'xlsx' for working with Excel files

const app = express();
const PORT = 7777;

// PostgreSQL database configuration
const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'postgres',
    password: '@AdminYokie',
    port: 5432, // Default PostgreSQL port
});

// Middleware to parse JSON requests
app.use(express.json());
app.use(express.static('public')); // Serve static files from the 'public' directory

// Route to handle barcode fetching based on component and date
app.post('/getBarcodes', async (req, res) => {
    const { component, date } = req.body;

    // Define the mapping between component and table name
    const tableMap = {
        prbc: 'prbc',
        pc: 'pc',
        plasma: 'plasma',
    };

    // Check if the provided component exists in the map
    const tableName = tableMap[component];
    if (!tableName) {
        return res.status(400).send('Invalid component selected.');
    }

    try {
        // Query the corresponding table for barcodes with the specified date
        const query = `
            SELECT barcodeid, volume, datecollection
            FROM ${tableName}
            WHERE datecollection = $1
        `;

        const { rows } = await pool.query(query, [date]);

        // Send the fetched barcodes back to the client
        res.json(rows);
    } catch (error) {
        console.error('Error fetching barcodes:', error);
        res.status(500).send('Server error. Please try again later.');
    }
});

// Route to generate the updated Excel file based on selected barcodes
app.post('/generateExcel', async (req, res) => {
    const { selectedBarcodes } = req.body; // Array of selected barcode IDs

    // Read the template Excel file
    const templatePath = path.join(__dirname, 'template.xlsx');
    const workbook = XLSX.readFile(templatePath);
    const worksheet = workbook.Sheets[workbook.SheetNames[0]]; // Assuming the first sheet

    // Start populating data from row 12
    let startRow = 12;

    try {
        // Prepare an SQL query to get volume and datecollection for all selected barcodes
        const query = `
            SELECT barcodeid, volume, datecollection 
            FROM prbc 
            WHERE barcodeid = ANY($1::text[])
        `;

        // Execute the query with selected barcodes
        const { rows } = await pool.query(query, [selectedBarcodes]);

        // Log the retrieved rows for debugging
        console.log('Retrieved rows:', rows);

        if (rows.length === 0) {
            return res.status(404).send('No data found for selected barcodes.');
        }

        // Populate the worksheet with data
        rows.forEach((row, index) => {
            // Populate index numbers in column A (A12, A13, A14, etc.)
            worksheet[`A${startRow}`] = { t: 'n', v: startRow - 11 }; // 1-based index

            // Populate barcode IDs in column B (B12, B13, B14, etc.)
            worksheet[`B${startRow}`] = { t: 's', v: row.barcodeid };

            // Populate volume in column C (C12, C13, C14, etc.)
            worksheet[`C${startRow}`] = { t: 'n', v: row.volume }; // Assuming volume is a number

            // Populate date of collection in column D (D12, D13, D14, etc.)
            worksheet[`D${startRow}`] = { t: 's', v: row.datecollection }; // Assuming date is a string

            // Move to the next row
            startRow++;
        });

        // Define the path for the generated file
        const generatedFilePath = path.join(__dirname, 'generated_Sero_Worksheet.xlsx');

        // Write the modified workbook to the file
        XLSX.writeFile(workbook, generatedFilePath);

        // Send the generated file back to the client for download
        res.download(generatedFilePath, 'Serology_Worksheet.xlsx', (err) => {
            if (err) {
                console.error('Error sending file:', err);
                res.status(500).send('Error generating Excel file.');
            }

            // Optional: Remove the generated file after download to keep the server clean
            fs.unlink(generatedFilePath, (unlinkErr) => {
                if (unlinkErr) console.error('Error deleting file:', unlinkErr);
            });
        });
    } catch (error) {
        console.error('Error generating Excel file:', error);
        res.status(500).send('Error generating Excel file.');
    }
});





// Route to serve the template Excel file
app.get('/template.xlsx', (req, res) => {
    res.sendFile(path.join(__dirname, 'template.xlsx'));
});

// Start the server
app.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
});
