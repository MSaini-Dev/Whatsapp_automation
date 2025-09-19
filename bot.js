const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

console.log('🚀 Starting Enhanced WhatsApp Grocery Bot...');

// Configuration
const CONFIG = {
    GOOGLE_SERVICE_ACCOUNT_KEY_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './service-account.json',
    GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || 'YOUR_GOOGLE_SHEET_ID',
    CATEGORIES_SHEET_NAME: process.env.CATEGORIES_SHEET_NAME || 'Categories',
    ITEMS_SHEET_NAME: process.env.ITEMS_SHEET_NAME || 'Items',
    SHOPKEEPER_JID: process.env.SHOPKEEPER_JID || '919982230201@c.us',
    PORT: process.env.PORT || 3000
};

// Will be populated from Google Sheets
let GROCERY_CATEGORIES = {};
let googleDoc;

// User session management
const userSessions = new Map();
const userOrders = new Map();

// Clean session
const sessionPath = './whatsapp-session';
if (fs.existsSync(sessionPath)) {
    console.log('🧹 Cleaning session...');
    fs.rmSync(sessionPath, { recursive: true, force: true });
}

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: "enhanced-grocery-bot",
        dataPath: sessionPath
    }),
    puppeteer: {
        headless: false,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox'
        ],
        timeout: 0
    }
});

let isReady = false;
let botNumber = '';

// Google Sheets setup and connectivity test
async function initializeGoogleSheets() {
    try {
        console.log('🔗 Connecting to Google Sheets...');
        
        // Check if service account file exists
        if (!fs.existsSync(CONFIG.GOOGLE_SERVICE_ACCOUNT_KEY_PATH)) {
            console.error('❌ Service account key file not found:', CONFIG.GOOGLE_SERVICE_ACCOUNT_KEY_PATH);
            console.log('💡 Please create a service account and download the key file');
            return false;
        }

        const serviceAccountAuth = new JWT({
            keyFile: CONFIG.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        googleDoc = new GoogleSpreadsheet(CONFIG.GOOGLE_SHEET_ID, serviceAccountAuth);
        
        // Test connection
        await googleDoc.loadInfo();
        console.log('✅ Google Sheets connected:', googleDoc.title);
        
        // Load catalog data
        await loadCatalogData();
        
        console.log('📊 Catalog loaded from Google Sheets');
        console.log('📋 Categories:', Object.keys(GROCERY_CATEGORIES).length);
        
        let itemCount = 0;
        Object.values(GROCERY_CATEGORIES).forEach(category => {
            itemCount += category.items.length;
        });
        console.log('📦 Total items:', itemCount);
        
        return true;
    } catch (error) {
        console.error('❌ Google Sheets initialization error:', error.message);
        console.log('💡 Make sure to:');
        console.log('1. Share your Google Sheet with the service account email');
        console.log('2. Check your Google Sheet ID');
        console.log('3. Verify your service account key file');
        return false;
    }
}

// Load catalog data from Google Sheets
async function loadCatalogData() {
    try {
        // Load categories
        const categoriesSheet = googleDoc.sheetsByTitle[CONFIG.CATEGORIES_SHEET_NAME];
        if (!categoriesSheet) {
            throw new Error(`Categories sheet "${CONFIG.CATEGORIES_SHEET_NAME}" not found`);
        }
        
        await categoriesSheet.loadHeaderRow();
        const categoryRows = await categoriesSheet.getRows();
        
        // Load items
        const itemsSheet = googleDoc.sheetsByTitle[CONFIG.ITEMS_SHEET_NAME];
        if (!itemsSheet) {
            throw new Error(`Items sheet "${CONFIG.ITEMS_SHEET_NAME}" not found`);
        }
        
        await itemsSheet.loadHeaderRow();
        const itemRows = await itemsSheet.getRows();
        
        // Build categories structure
        GROCERY_CATEGORIES = {};
        
        for (const row of categoryRows) {
            const id = row.get('ID');
            GROCERY_CATEGORIES[id] = {
                name: row.get('Name'),
                emoji: row.get('Emoji') || '📦',
                items: []
            };
        }
        
        // Add items to categories
        for (const row of itemRows) {
            const categoryId = row.get('Category ID');
            if (GROCERY_CATEGORIES[categoryId]) {
                GROCERY_CATEGORIES[categoryId].items.push({
                    id: row.get('ID'),
                    name: row.get('Name'),
                    price: parseFloat(row.get('Price')),
                    unit: row.get('Unit')
                });
            }
        }
        
        console.log('✅ Catalog data loaded successfully');
    } catch (error) {
        console.error('❌ Error loading catalog data:', error.message);
        throw error;
    }
}

// Helper functions (same as before but with fallback for empty catalog)
function formatCategoriesMenu() {
    // If catalog is empty, show error message
    if (Object.keys(GROCERY_CATEGORIES).length === 0) {
        return `❌ Catalog not available\n\nPlease try again later or contact support.`;
    }
    
    let menu = `🛒 *Welcome to Fresh Mart Grocery Store!*\n\n`;
    menu += `📋 *Select a Category:*\n\n`;
    
    Object.keys(GROCERY_CATEGORIES).forEach(key => {
        const category = GROCERY_CATEGORIES[key];
        menu += `${key}️⃣ ${category.name}\n`;
    });
    
    menu += `\n💡 *How to order:*\n`;
    menu += `• Type category number (1-${Object.keys(GROCERY_CATEGORIES).length})\n`;
    menu += `• Select items with quantity\n`;
    menu += `• Review and confirm order\n\n`;
    menu += `Type *help* for more commands`;
    
    return menu;
}

function formatCategoryItems(categoryKey) {
    const category = GROCERY_CATEGORIES[categoryKey];
    if (!category) return `❌ Category not found!\n\nType "start" to see available categories.`;
    
    if (category.items.length === 0) {
        return `❌ No items available in this category\n\nType "back" to return to categories.`;
    }
    
    let itemsList = `${category.emoji} *${category.name}*\n\n`;
    itemsList += `📦 *Available Items:*\n\n`;
    
    category.items.forEach((item, index) => {
        itemsList += `${index + 1}. ${item.name}\n`;
        itemsList += `   💰 ₹${item.price}/${item.unit}\n\n`;
    });
    
    itemsList += `📝 *How to add items:*\n\n`;
    itemsList += `*Single item:*\n`;
    itemsList += `• "1 2" = 2x ${category.items[0]?.name}\n`;
    itemsList += `• "1 500g" = 500g ${category.items[0]?.name}\n\n`;
    itemsList += `*Multiple items:*\n`;
    itemsList += `• "1 2, 3 1" = item 1 (qty 2) + item 3 (qty 1)\n`;
    itemsList += `• "1 500g, 2 2, 5 1kg" = mixed quantities\n\n`;
    itemsList += `*Supported units:* kg, g, l, ml\n\n`;
    itemsList += `🔙 Type "back" to return to categories\n`;
    itemsList += `🛒 Type "cart" to view your cart`;
    
    return itemsList;
}

// Event handlers
client.on('qr', (qr) => {
    console.log('\n🔥 SCAN THIS QR CODE NOW!');
    qrcode.generate(qr, { small: true });
    console.log('\n📱 Open WhatsApp > Settings > Linked Devices > Link a Device');
});

client.on('authenticated', () => {
    console.log('✅ AUTHENTICATED!');
});

client.on('ready', async () => {
    isReady = true;
    botNumber = client.info.wid.user;
    console.log('\n🎉 BOT IS READY!');
    console.log('📞 Bot Number:', botNumber);
    console.log('👤 Bot Name:', client.info.pushname);
    
    // Initialize Google Sheets and load catalog
    const sheetsConnected = await initializeGoogleSheets();
    
    if (!sheetsConnected) {
        console.log('⚠️ Using fallback mode - Google Sheets not available');
        // You could load a fallback catalog here if needed
    }
    
    console.log('\n🔍 Now monitoring messages...');
});

// Message handler (simplified for testing)
client.on('message', async (msg) => {
    console.log(`📨 Message from ${msg.from}: "${msg.body}"`);
    
    if (!isReady || msg.type !== 'chat' || !msg.body) return;
    
    const userPhone = msg.from;
    const text = msg.body.toLowerCase().trim();
    
    try {
        let response = '';
        
        if (['start', 'menu', 'hello', 'hi'].includes(text)) {
            response = formatCategoriesMenu();
        } else if (text === 'test') {
            // Test command to check Google Sheets connectivity
            if (Object.keys(GROCERY_CATEGORIES).length > 0) {
                response = `✅ Google Sheets Connected!\n\n`;
                response += `📊 Sheet: ${googleDoc.title}\n`;
                response += `📋 Categories: ${Object.keys(GROCERY_CATEGORIES).length}\n`;
                
                let itemCount = 0;
                Object.values(GROCERY_CATEGORIES).forEach(category => {
                    itemCount += category.items.length;
                });
                response += `📦 Total Items: ${itemCount}\n\n`;
                
                response += `Sample categories:\n`;
                Object.entries(GROCERY_CATEGORIES).slice(0, 3).forEach(([key, category]) => {
                    response += `${key}. ${category.name} (${category.items.length} items)\n`;
                });
            } else {
                response = `❌ Google Sheets Not Connected\n\n`;
                response += `Please check your configuration and try again.`;
            }
        } else if (text === 'help') {
            response = `🤖 *Grocery Bot Test Commands*\n\n`;
            response += `• start - Show categories\n`;
            response += `• test - Test Google Sheets connection\n`;
            response += `• help - Show this menu\n\n`;
            response += `This is a connectivity test version.`;
        } else {
            response = `❓ Unknown command\n\nType "start" to begin or "test" to check Google Sheets connection.`;
        }
        
        await msg.reply(response);
        console.log(`✅ Response sent to ${userPhone}`);
        
    } catch (error) {
        console.error('❌ Error processing message:', error.message);
        try {
            await msg.reply('⚠️ Something went wrong. Please try again.');
        } catch (e) {
            console.error('❌ Could not send error reply');
        }
    }
});

// Error handlers
client.on('disconnected', (reason) => {
    console.log(`🔌 Disconnected: ${reason}`);
    isReady = false;
});

client.on('error', (error) => {
    console.error(`❌ Client error: ${error.message}`);
});

// Graceful shutdown
process.on('SIGINT', async () => {
    console.log('\n🛑 Shutting down...');
    if (client) await client.destroy();
    process.exit(0);
});

console.log('🔄 Initializing WhatsApp client...');
client.initialize();