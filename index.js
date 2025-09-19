const { Client, LocalAuth } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const fs = require('fs');
const { GoogleSpreadsheet } = require('google-spreadsheet');
const { JWT } = require('google-auth-library');

console.log('🚀 Starting Enhanced WhatsApp Grocery Bot...');

// Configuration
const CONFIG = {
    GOOGLE_SERVICE_ACCOUNT_KEY_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './service-account.json',
    GOOGLE_SHEET_ID: process.env.GOOGLE_SHEET_ID || '1GjfGGdCfGiPkphGrPsKIqdvDeOL3Xu9nxQcOGIx-VSs',
    SHOPKEEPER_JID: process.env.SHOPKEEPER_JID || '919982230201@c.us',
    PORT: process.env.PORT || 3000
};

// Mock grocery data - Replace with your database
const GROCERY_CATEGORIES = {
    '1': {
        name: '🍪 Biscuits & Cookies',
        emoji: '🍪',
        items: [
            { id: 'b1', name: 'Parle-G Biscuits', price: 20, unit: 'pack' },
            { id: 'b2', name: 'Good Day Cookies', price: 35, unit: 'pack' },
            { id: 'b3', name: 'Oreo Cookies', price: 45, unit: 'pack' },
            { id: 'b4', name: 'Marie Gold Biscuits', price: 25, unit: 'pack' },
            { id: 'b5', name: 'Bourbon Biscuits', price: 30, unit: 'pack' }
        ]
    },
    '2': {
        name: '🥛 Dairy Products',
        emoji: '🥛',
        items: [
            { id: 'd1', name: 'Fresh Milk', price: 55, unit: '1L' },
            { id: 'd2', name: 'Amul Butter', price: 52, unit: '100g' },
            { id: 'd3', name: 'Paneer', price: 80, unit: '250g' },
            { id: 'd4', name: 'Curd', price: 40, unit: '500g' },
            { id: 'd5', name: 'Cheese Slices', price: 120, unit: '200g' }
        ]
    },
    '3': {
        name: '🍎 Fruits & Vegetables',
        emoji: '🍎',
        items: [
            { id: 'f1', name: 'Apples', price: 150, unit: '1kg' },
            { id: 'f2', name: 'Bananas', price: 60, unit: '1kg' },
            { id: 'f3', name: 'Onions', price: 30, unit: '1kg' },
            { id: 'f4', name: 'Tomatoes', price: 40, unit: '1kg' },
            { id: 'f5', name: 'Potatoes', price: 25, unit: '1kg' }
        ]
    },
    '4': {
        name: '🍚 Rice & Grains',
        emoji: '🍚',
        items: [
            { id: 'r1', name: 'Basmati Rice', price: 120, unit: '1kg' },
            { id: 'r2', name: 'Wheat Flour', price: 45, unit: '1kg' },
            { id: 'r3', name: 'Toor Dal', price: 90, unit: '1kg' },
            { id: 'r4', name: 'Moong Dal', price: 85, unit: '1kg' },
            { id: 'r5', name: 'Chana Dal', price: 70, unit: '1kg' }
        ]
    },
    '5': {
        name: '🧴 Personal Care',
        emoji: '🧴',
        items: [
            { id: 'p1', name: 'Colgate Toothpaste', price: 95, unit: '150g' },
            { id: 'p2', name: 'Head & Shoulders Shampoo', price: 180, unit: '400ml' },
            { id: 'p3', name: 'Dettol Soap', price: 35, unit: 'piece' },
            { id: 'p4', name: 'Johnson Baby Oil', price: 120, unit: '200ml' },
            { id: 'p5', name: 'Nivea Cream', price: 85, unit: '75ml' }
        ]
    }
};

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
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-timer-throttling',
            '--disable-backgrounding-occluded-windows',
            '--disable-renderer-backgrounding',
            '--disable-features=TranslateUI',
            '--disable-ipc-flooding-protection'
        ],
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || undefined
    }
});
let isReady = false;
let botNumber = '';

// Google Sheets setup
let googleDoc;
let ordersSheet;

async function initializeGoogleSheets() {
    try {
        const serviceAccountAuth = new JWT({
            keyFile: CONFIG.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
            scopes: ['https://www.googleapis.com/auth/spreadsheets'],
        });

        googleDoc = new GoogleSpreadsheet(CONFIG.GOOGLE_SHEET_ID, serviceAccountAuth);
        await googleDoc.loadInfo();
        console.log('📊 Google Sheets connected:', googleDoc.title);

        // Get or create orders sheet
        ordersSheet = googleDoc.sheetsByTitle['Orders'] || await googleDoc.addSheet({ 
            title: 'Orders',
            headerValues: ['Order ID', 'Customer Name', 'Phone', 'Items', 'Total Amount', 'Status', 'Date', 'Time']
        });

        // Add sample data if sheet is empty
        const rows = await ordersSheet.getRows();
        if (rows.length === 0) {
            await addSampleData();
        }

        console.log('✅ Google Sheets initialized');
    } catch (error) {
        console.error('❌ Google Sheets initialization error:', error.message);
        console.log('💡 Make sure to share your Google Sheet with the service account email');
    }
}

async function addSampleData() {
    const sampleOrders = [
        {
            'Order ID': 'ORD001',
            'Customer Name': 'John Doe',
            'Phone': '9876543210',
            'Items': 'Parle-G Biscuits x2, Fresh Milk x1',
            'Total Amount': '₹95',
            'Status': 'Completed',
            'Date': '2025-01-15',
            'Time': '10:30 AM'
        },
        {
            'Order ID': 'ORD002',
            'Customer Name': 'Jane Smith',
            'Phone': '8765432109',
            'Items': 'Apples x1kg, Bananas x2kg, Onions x1kg',
            'Total Amount': '₹270',
            'Status': 'Pending',
            'Date': '2025-01-15',
            'Time': '11:45 AM'
        }
    ];

    for (const order of sampleOrders) {
        await ordersSheet.addRow(order);
    }
    console.log('📝 Sample data added to sheet');
}

async function saveOrderToSheet(orderData) {
    try {
        if (!ordersSheet) {
            console.log('⚠️ Orders sheet not initialized - saving to local backup');
            // Save to local file as backup
            const backupData = {
                timestamp: new Date().toISOString(),
                ...orderData
            };
            fs.appendFileSync('./orders-backup.txt', JSON.stringify(backupData) + '\n');
            return;
        }

        await ordersSheet.addRow({
            'Order ID': orderData.orderId,
            'Customer Name': orderData.customerName,
            'Phone': orderData.phone,
            'Items': orderData.items,
            'Total Amount': `₹${orderData.totalAmount}`,
            'Status': 'Pending',
            'Date': new Date().toLocaleDateString('en-IN'),
            'Time': new Date().toLocaleTimeString('en-IN')
        });

        console.log('✅ Order saved to Google Sheets:', orderData.orderId);
    } catch (error) {
        console.error('❌ Error saving to sheet:', error.message);
        // Save to local backup
        const backupData = {
            timestamp: new Date().toISOString(),
            error: error.message,
            ...orderData
        };
        fs.appendFileSync('./orders-backup.txt', JSON.stringify(backupData) + '\n');
        console.log('💾 Order saved to local backup file');
    }
}

// Helper functions
function generateOrderId() {
    return 'ORD' + Date.now().toString().slice(-6);
}

function formatCategoriesMenu() {
    let menu = `🛒 *Welcome to Fresh Mart Grocery Store!*\n\n`;
    menu += `📋 *Select a Category:*\n\n`;
    
    Object.keys(GROCERY_CATEGORIES).forEach(key => {
        const category = GROCERY_CATEGORIES[key];
        menu += `${key}️⃣ ${category.name}\n`;
    });
    
    menu += `\n💡 *How to order:*\n`;
    menu += `• Type category number (1-5)\n`;
    menu += `• Select items with quantity\n`;
    menu += `• Review and confirm order\n\n`;
    menu += `Type *help* for more commands`;
    
    return menu;
}

// Update the formatCategoryItems function to show the new syntax
function formatCategoryItems(categoryKey) {
    const category = GROCERY_CATEGORIES[categoryKey];
    if (!category) return null;
    
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

// Update formatCart to show display quantities
function formatCart(userPhone) {
    const order = userOrders.get(userPhone) || { items: [], total: 0 };
    
    if (order.items.length === 0) {
        return `🛒 *Your Cart is Empty*\n\nType a category number (1-5) to start shopping!`;
    }
    
    let cartText = `🛒 *Your Shopping Cart*\n\n`;
    
    order.items.forEach((item, index) => {
        cartText += `${index + 1}. ${item.name}\n`;
        cartText += `   Qty: ${item.displayQuantity || `${item.quantity} ${item.unit}`}\n`;
        cartText += `   Price: ₹${item.totalPrice || (item.price * item.quantity)}\n\n`;
    });
    
    cartText += `💰 *Total: ₹${Math.round(order.total)}*\n\n`;
    cartText += `✅ Type "confirm" to place order\n`;
    cartText += `🗑️ Type "clear" to empty cart\n`;
    cartText += `🔙 Type "back" to continue shopping`;
    
    return cartText;
}

// Enhanced item selection processor
async function processItemSelection(text, categoryKey, userPhone) {
    const category = GROCERY_CATEGORIES[categoryKey];
    if (!category) return "❌ Category not found!";
    
    // Split by comma for multiple items: "1 2, 3 1, 5 500g"
    const itemInputs = text.split(',').map(input => input.trim());
    const addedItems = [];
    const errors = [];
    
    for (const input of itemInputs) {
        const result = parseItemInput(input, category, userPhone);
        if (result.success) {
            addedItems.push(result.item);
        } else {
            errors.push(result.error);
        }
    }
    
    if (addedItems.length === 0) {
        // No items added, show error and help
        let response = `❌ *Unable to add items*\n\n`;
        errors.forEach(error => response += `• ${error}\n`);
        response += `\n💡 *Correct formats:*\n`;
        response += `• Single item: "1 2" (item 1, qty 2)\n`;
        response += `• Multiple items: "1 2, 3 1, 5 3"\n`;
        response += `• Custom quantity: "1 500g" or "2 2.5kg"\n`;
        response += `• Mixed: "1 2, 3 500g, 5 1.5kg"\n\n`;
        response += `📋 Available items: 1-${category.items.length}`;
        return response;
    }
    
    // Build success response
    let response = `✅ *Added to Cart*\n\n`;
    
    if (addedItems.length === 1) {
        const item = addedItems[0];
        response += `${category.emoji} ${item.name}\n`;
        response += `Quantity: ${item.displayQuantity}\n`;
        response += `Price: ₹${item.totalPrice}\n\n`;
    } else {
        response += `${category.emoji} *${addedItems.length} items added:*\n\n`;
        addedItems.forEach((item, index) => {
            response += `${index + 1}. ${item.name}\n`;
            response += `   Qty: ${item.displayQuantity}\n`;
            response += `   Price: ₹${item.totalPrice}\n\n`;
        });
    }
    
    const order = userOrders.get(userPhone) || { items: [], total: 0 };
    response += `🛒 Cart Total: ₹${order.total}\n\n`;
    
    if (errors.length > 0) {
        response += `⚠️ *Some items couldn't be added:*\n`;
        errors.forEach(error => response += `• ${error}\n`);
        response += `\n`;
    }
    
    response += `Continue shopping or type:\n`;
    response += `• "cart" to view full cart\n`;
    response += `• "back" for categories\n`;
    response += `• "confirm" to place order`;
    
    return response;
}

// Parse individual item input
function parseItemInput(input, category, userPhone) {
    // Remove extra spaces and convert to lowercase
    const cleanInput = input.toLowerCase().trim();
    
    // Parse different formats:
    // "1 2" = item 1, quantity 2
    // "1 500g" = item 1, 500 grams
    // "2 2.5kg" = item 2, 2.5 kilograms
    // "3 1.5l" = item 3, 1.5 liters
    
    const parts = cleanInput.split(' ');
    if (parts.length !== 2) {
        return { success: false, error: `"${input}" - Use format: item_number quantity` };
    }
    
    const itemIndex = parseInt(parts[0]) - 1;
    const quantityPart = parts[1];
    
    // Validate item index
    if (isNaN(itemIndex) || itemIndex < 0 || itemIndex >= category.items.length) {
        return { 
            success: false, 
            error: `"${input}" - Item ${parts[0]} not found (use 1-${category.items.length})` 
        };
    }
    
    const item = category.items[itemIndex];
    
    // Parse quantity - could be number, or number with unit
    const quantityResult = parseQuantity(quantityPart, item);
    if (!quantityResult.success) {
        return { 
            success: false, 
            error: `"${input}" - ${quantityResult.error}` 
        };
    }
    
    // Add to cart
    const order = userOrders.get(userPhone) || { items: [], total: 0 };
    
    // Check if item already in cart
    const existingIndex = order.items.findIndex(cartItem => cartItem.id === item.id);
    
    const finalQuantity = quantityResult.quantity;
    const totalPrice = Math.round(item.price * finalQuantity);
    const displayQuantity = quantityResult.displayQuantity;
    
    if (existingIndex >= 0) {
        // Update existing item
        const oldPrice = order.items[existingIndex].totalPrice || (order.items[existingIndex].price * order.items[existingIndex].quantity);
        order.items[existingIndex].quantity = finalQuantity;
        order.items[existingIndex].totalPrice = totalPrice;
        order.items[existingIndex].displayQuantity = displayQuantity;
        order.total = order.total - oldPrice + totalPrice;
    } else {
        // Add new item
        order.items.push({
            id: item.id,
            name: item.name,
            price: item.price,
            quantity: finalQuantity,
            unit: item.unit,
            totalPrice: totalPrice,
            displayQuantity: displayQuantity
        });
        order.total += totalPrice;
    }
    
    userOrders.set(userPhone, order);
    
    return {
        success: true,
        item: {
            name: item.name,
            displayQuantity: displayQuantity,
            totalPrice: totalPrice
        }
    };
}

// Parse quantity with unit support
function parseQuantity(quantityPart, item) {
    // Extract number and unit
    const match = quantityPart.match(/^([0-9]+\.?[0-9]*)([a-z]*)$/);
    if (!match) {
        return { success: false, error: "Invalid quantity format" };
    }
    
    const number = parseFloat(match[1]);
    const unit = match[2] || '';
    
    if (isNaN(number) || number <= 0) {
        return { success: false, error: "Quantity must be greater than 0" };
    }
    
    // If no unit specified, use as-is
    if (!unit) {
        return {
            success: true,
            quantity: number,
            displayQuantity: `${number} ${item.unit}`
        };
    }
    
    // Convert units based on item's base unit
    const baseUnit = item.unit.toLowerCase();
    const inputUnit = unit.toLowerCase();
    
    let finalQuantity = number;
    let displayQuantity = `${number}${unit}`;
    
    // Handle weight conversions (kg to base unit)
    if (inputUnit === 'kg' || inputUnit === 'kgs') {
        if (baseUnit.includes('kg')) {
            finalQuantity = number; // already in kg
            displayQuantity = `${number}kg`;
        } else if (baseUnit.includes('g')) {
            finalQuantity = number; // treat as kg equivalent for pricing
            displayQuantity = `${number}kg`;
        } else {
            finalQuantity = number; // use as multiplier
            displayQuantity = `${number}kg`;
        }
    }
    // Handle gram conversions
    else if (inputUnit === 'g' || inputUnit === 'gm' || inputUnit === 'gms') {
        if (baseUnit.includes('kg')) {
            finalQuantity = number / 1000; // convert g to kg
            displayQuantity = `${number}g`;
        } else if (baseUnit.includes('g')) {
            // Find base unit quantity (e.g., "250g" base unit)
            const baseMatch = baseUnit.match(/(\d+)/);
            if (baseMatch) {
                const baseGrams = parseInt(baseMatch[1]);
                finalQuantity = number / baseGrams; // how many base units
                displayQuantity = `${number}g`;
            } else {
                finalQuantity = number / 1000; // assume kg pricing
                displayQuantity = `${number}g`;
            }
        } else {
            finalQuantity = number / 1000; // default conversion
            displayQuantity = `${number}g`;
        }
    }
    // Handle liter conversions
    else if (inputUnit === 'l' || inputUnit === 'lt' || inputUnit === 'ltr' || inputUnit === 'litre' || inputUnit === 'liter') {
        if (baseUnit.includes('l')) {
            const baseMatch = baseUnit.match(/(\d+)/);
            if (baseMatch) {
                const baseLiters = parseInt(baseMatch[1]);
                finalQuantity = number / baseLiters;
                displayQuantity = `${number}L`;
            } else {
                finalQuantity = number;
                displayQuantity = `${number}L`;
            }
        } else {
            finalQuantity = number;
            displayQuantity = `${number}L`;
        }
    }
    // Handle milliliter conversions
    else if (inputUnit === 'ml' || inputUnit === 'mls') {
        if (baseUnit.includes('ml')) {
            const baseMatch = baseUnit.match(/(\d+)/);
            if (baseMatch) {
                const baseMl = parseInt(baseMatch[1]);
                finalQuantity = number / baseMl;
                displayQuantity = `${number}ml`;
            } else {
                finalQuantity = number / 1000;
                displayQuantity = `${number}ml`;
            }
        } else if (baseUnit.includes('l')) {
            finalQuantity = number / 1000;
            displayQuantity = `${number}ml`;
        } else {
            finalQuantity = number / 1000;
            displayQuantity = `${number}ml`;
        }
    }
    else {
        return { success: false, error: `Unknown unit "${unit}" - use kg, g, l, ml or just numbers` };
    }
    
    return {
        success: true,
        quantity: finalQuantity,
        displayQuantity: displayQuantity
    };
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
    
    // Initialize Google Sheets
    await initializeGoogleSheets();
    
    console.log('\n🔍 Now monitoring messages...');
});

// Enhanced message handler for multiple items and custom quantities
client.on('message', async (msg) => {
    console.log(`📨 Message from ${msg.from}: "${msg.body}"`);
    
    if (!isReady || msg.type !== 'chat' || !msg.body) return;
    
    const userPhone = msg.from;
    const text = msg.body.toLowerCase().trim();
    const session = userSessions.get(userPhone) || { state: 'main', category: null };
    
    try {
        let response = '';
        
        // Main commands
        if (['start', 'menu', 'categories', 'shop'].includes(text)) {
            session.state = 'main';
            response = formatCategoriesMenu();
            
        } else if (text === 'help') {
            response = `🤖 *Grocery Bot Commands*\n\n`;
            response += `🛒 *Shopping:*\n`;
            response += `• start/menu - Show categories\n`;
            response += `• cart - View your cart\n`;
            response += `• confirm - Place order\n`;
            response += `• clear - Empty cart\n\n`;
            response += `📦 *Adding Items:*\n`;
            response += `• Single: "1 2" (item 1, qty 2)\n`;
            response += `• Multiple: "1 2, 3 1, 5 3"\n`;
            response += `• Custom qty: "1 500g" or "2 2.5kg"\n\n`;
            response += `📞 *Support:*\n`;
            response += `• help - Show this menu\n`;
            response += `• contact - Store contact info\n\n`;
            response += `Ready to help you shop! 🎉`;
            
        } else if (text === 'contact') {
            response = `📞 *Fresh Mart Contact Info*\n\n`;
            response += `🏪 Store: Fresh Mart Grocery\n`;
            response += `📍 Address: 123 Market Street\n`;
            response += `⏰ Timing: 8 AM - 10 PM\n`;
            response += `📱 Phone: +91 99822 30201\n\n`;
            response += `🚚 Free delivery above ₹500!`;
            
        } else if (text === 'cart') {
            response = formatCart(userPhone);
            
        } else if (text === 'clear') {
            userOrders.delete(userPhone);
            response = `🗑️ *Cart Cleared*\n\nType "start" to begin shopping again!`;
            
        } else if (text === 'back') {
            if (session.state === 'category') {
                session.state = 'main';
                response = formatCategoriesMenu();
            } else {
                response = `🔙 You're already at the main menu!\n\n` + formatCategoriesMenu();
            }
            
        } else if (text === 'confirm') {
            const order = userOrders.get(userPhone);
            if (!order || order.items.length === 0) {
                response = `🛒 Your cart is empty!\n\nType "start" to begin shopping.`;
            } else {
                // Generate order logic
                const orderId = generateOrderId();
                const contact = await msg.getContact();
                
                const orderData = {
                    orderId: orderId,
                    customerName: contact.name || contact.pushname || 'Unknown',
                    phone: userPhone.replace('@c.us', ''),
                    items: order.items.map(item => `${item.name} x${item.displayQuantity || item.quantity}`).join(', '),
                    totalAmount: Math.round(order.total)
                };
                
                // Save to Google Sheets (with backup)
                await saveOrderToSheet(orderData);
                
                response = `✅ *Order Confirmed!*\n\n`;
                response += `📋 Order ID: ${orderId}\n`;
                response += `💰 Total: ₹${Math.round(order.total)}\n\n`;
                response += `📦 *Your Items:*\n`;
                order.items.forEach(item => {
                    response += `• ${item.name} x${item.displayQuantity || item.quantity}\n`;
                });
                response += `\n🚚 We'll deliver within 1-2 hours!\n`;
                response += `📞 Contact: +91 99822 30201\n\n`;
                response += `Thank you for shopping with Fresh Mart! 🎉`;
                
                // FIXED: Notify shopkeeper - changed const to let
                if (CONFIG.SHOPKEEPER_JID) {
                    let shopkeeperMsg = `🆕 *NEW ORDER RECEIVED*\n\n`; // Fixed: changed from const to let
                    shopkeeperMsg += `📋 Order ID: ${orderId}\n`;
                    shopkeeperMsg += `👤 Customer: ${orderData.customerName}\n`;
                    shopkeeperMsg += `📞 Phone: ${orderData.phone}\n`;
                    shopkeeperMsg += `💰 Amount: ₹${Math.round(order.total)}\n\n`;
                    shopkeeperMsg += `📦 Items:\n${orderData.items}\n\n`;
                    shopkeeperMsg += `📊 Check Google Sheets for details!`;
                    
                    try {
                        await client.sendMessage(CONFIG.SHOPKEEPER_JID, shopkeeperMsg);
                        console.log('📱 Shopkeeper notified');
                    } catch (error) {
                        console.error('❌ Failed to notify shopkeeper:', error.message);
                    }
                }
                
                // Clear user's cart and reset session
                userOrders.delete(userPhone);
                session.state = 'main';
            }
            
        } else if (session.state === 'main' && ['1', '2', '3', '4', '5'].includes(text)) {
            // Category selection
            session.state = 'category';
            session.category = text;
            response = formatCategoryItems(text);
            
        } else if (session.state === 'category' && session.category) {
            // Enhanced item selection - supports multiple items and custom quantities
            response = await processItemSelection(text, session.category, userPhone);
            
        } else {
            // Default response
            response = `❓ I didn't understand that.\n\n` + formatCategoriesMenu();
            session.state = 'main';
        }
        
        // Update session
        userSessions.set(userPhone, session);
        
        // Send response
        await msg.reply(response);
        console.log(`✅ Response sent to ${userPhone}`);
        
    } catch (error) {
        console.error('❌ Error processing message:', error.message);
        try {
            await msg.reply('⚠️ Something went wrong. Please try again or type "help".');
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
