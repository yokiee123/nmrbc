const express = require('express');
const bodyParser = require('body-parser');
const { Pool } = require('pg');
const ExcelJS = require('exceljs');
const path = require('path');
const fs = require('fs');
const os = require('os');

// Create Express app and database pool
const app = express();
const pool = new Pool({
  user: 'postgres',
  host: 'localhost',
  database: 'postgres',
  password: '@AdminYokie',
  port: 5432,
});

// Serve static files (e.g., "public" folder for HTML)
app.use(express.static(path.join(__dirname, 'public')));
app.use(bodyParser.json());

// Route to search barcodes or by date collection
app.get('/search', async (req, res) => {
  const { component, query, searchByDate } = req.query;

  // Validate component to avoid SQL injection
  const validComponents = ['prbc', 'pc', 'plasma'];
  if (!validComponents.includes(component)) {
    return res.status(400).send('Invalid component selected.');
  }

  try {
    let result;
    if (searchByDate === 'true') {
      // Search by date collection
      result = await pool.query(`
        SELECT *, 
          TO_CHAR(datecollection, 'YYYY-MM-DD') AS formatted_datecollection 
        FROM ${component} 
        WHERE datecollection::date = $1`, [query]);
    } else {
      // Search by barcode ID
      result = await pool.query(`
        SELECT *, 
          TO_CHAR(datecollection, 'YYYY-MM-DD') AS formatted_datecollection 
        FROM ${component} 
        WHERE barcodeid ILIKE $1`, [`%${query}%`]);
    }

    // Format the result rows to replace datecollection with formatted_datecollection
    const formattedRows = result.rows.map(row => ({
      ...row,
      datecollection: row.formatted_datecollection
    }));

    res.json(formattedRows); // Send search results with formatted date
  } catch (error) {
    console.error('Database query error:', error);
    res.status(500).send('Database query failed.');
  }
});

// Route to generate Excel transmittal
app.post('/transmittal', async (req, res) => {
  const { barcodes } = req.body;

  try {
    // Create an Excel workbook
    const workbook = new ExcelJS.Workbook();
    const worksheet = workbook.addWorksheet('Transmittal');

    // Define columns
    worksheet.columns = [
      { header: 'Barcode ID', key: 'barcodeid', width: 15 },
      { header: 'Component', key: 'component', width: 10 },
      { header: 'Volume', key: 'volume', width: 10 },
      { header: 'Date Collection', key: 'datecollection', width: 15 },
      { header: 'Expiry Date', key: 'expirydate', width: 15 },
      { header: 'Screening Results', key: 'screening_results', width: 25 },
    ];

    // Add rows to worksheet from the provided barcode data
    barcodes.forEach(barcode => worksheet.addRow({
      barcodeid: barcode.barcodeid,
      component: barcode.component,
      volume: barcode.volume,
      datecollection: barcode.datecollection,
      expirydate: barcode.expirydate,
      screening_results: barcode.screening_results,
    }));

    // Define a temporary file path to store the Excel file
    const tempFilePath = path.join(os.tmpdir(), 'transmittal.xlsx');

    // Write the Excel file to the temporary file
    await workbook.xlsx.writeFile(tempFilePath);

    // Set headers to serve the Excel file
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', 'attachment; filename=transmittal.xlsx');

    // Create a file stream and send it to the client
    const fileStream = fs.createReadStream(tempFilePath);
    fileStream.pipe(res);

    // Clean up the temporary file after the response is done
    fileStream.on('end', () => {
      fs.unlink(tempFilePath, (err) => {
        if (err) console.error('Error deleting temporary file:', err);
      });
    });
  } catch (error) {
    console.error('Failed to generate Excel file:', error);
    res.status(500).send('Failed to generate Excel file.');
  }
});

// Start the server on port 8888
app.listen(8888, () => {
  console.log('Server running on http://localhost:8888');
});
