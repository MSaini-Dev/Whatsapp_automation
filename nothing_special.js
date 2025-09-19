require("dotenv").config();
const express = require("express");
const { google } = require("googleapis");

const app = express();
app.use(express.json());

async function getSheetsClient() {
  const auth = new google.auth.GoogleAuth({
    keyFile: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
    scopes: ["https://www.googleapis.com/auth/spreadsheets"],
  });

  const client = await auth.getClient();
  return google.sheets({ version: "v4", auth: client });
}

// ✅ Route: Get sheet data
app.get("/api/sheet", async (req, res) => {
  try {
    const sheets = await getSheetsClient();

    const response = await sheets.spreadsheets.values.get({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Sheet1!A1:D10", // Change as per your sheet
    });

    res.json({ data: response.data.values });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to fetch sheet data" });
  }
});

// ✅ Route: Append data
app.post("/api/sheet", async (req, res) => {
  try {
    const { values } = req.body; // Expecting [["Col1", "Col2"]]
    const sheets = await getSheetsClient();

    await sheets.spreadsheets.values.append({
      spreadsheetId: process.env.GOOGLE_SHEET_ID,
      range: "Sheet1!A1",
      valueInputOption: "RAW",
      requestBody: { values },
    });

    res.json({ success: true, message: "Data added to sheet" });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: "Failed to append data" });
  }
});

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
