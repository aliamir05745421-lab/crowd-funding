require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Middleware
app.use(cors({
  origin: ['https://fundbridge.space', 'http://localhost:5000', 'https://crowd-funding-9pug.onrender.com'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));
app.get('/refund.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'refund.html')));
app.get('/contact.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'contact.html')));

console.log('📁 Serving files from:', path.join(__dirname, 'public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true
})
.then(() => console.log('✅ MongoDB Connected Successfully'))
.catch(err => console.error('❌ MongoDB Connection Error:', err));

// ========== SCHEMAS ==========

const campaignSchema = new mongoose.Schema({
  title: { type: String, required: true, trim: true },
  category: { type: String, required: true, enum: ['Medical', 'Education', 'Business', 'Charity', 'Emergency', 'Other'] },
  description: { type: String, required: true },
  targetAmount: { type: Number, default: 1000 },
  goalAmount: { type: Number, default: 1000 }, // For backward compatibility
  raisedAmount: { type: Number, default: 0 },
  imageUrl: { type: String, required: true },
  videoUrl: { type: String, default: '' },
  creatorName: { type: String, required: true },
  creatorEmail: { type: String, required: true },
  creatorWallet: { type: String, required: true },
  status: { type: String, enum: ['Pending', 'Active', 'Rejected', 'Completed', 'pending', 'active', 'rejected', 'completed'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  donations: [{
    donorName: { type: String, default: 'Anonymous' },
    amount: { type: Number, required: true },
    transactionId: { type: String, required: true },
    txHash: { type: String, default: '' },
    gateway: { type: String, enum: ['Transak', 'MoonPay', 'Ramp', 'Wert', 'Mercuryo', 'AlchemyPay', 'Banxa'], required: true },
    date: { type: Date, default: Date.now }
  }]
});

const adminSchema = new mongoose.Schema({
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  createdAt: { type: Date, default: Date.now }
});

const transactionSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  amount: { type: Number, required: true },
  currency: { type: String, default: 'USD' },
  cryptoAmount: { type: Number, required: true },
  cryptoCurrency: { type: String, default: 'USDC' },
  donorEmail: { type: String, default: '' },
  donorName: { type: String, default: 'Anonymous' },
  gateway: { type: String, enum: ['Transak', 'MoonPay', 'Ramp', 'Wert', 'Mercuryo', 'AlchemyPay', 'Banxa'], required: true },
  gatewayTransactionId: { type: String, required: true },
  txHash: { type: String, default: '' },
  walletAddress: { type: String, required: true },
  status: { type: String, enum: ['Pending', 'Completed', 'Failed'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

const Campaign = mongoose.model('Campaign', campaignSchema);
const Admin = mongoose.model('Admin', adminSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

// ========== AUTH MIDDLEWARE ==========
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) {
      return res.status(401).json({ error: 'Authentication required' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id);
    if (!admin) {
      return res.status(401).json({ error: 'Admin not found' });
    }
    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid or expired token' });
  }
};

// ========== INITIALIZE ADMIN ==========
const initializeAdmin = async () => {
  try {
    const adminExists = await Admin.findOne({ email: process.env.ADMIN_EMAIL });
    if (!adminExists) {
      const hashedPassword = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await Admin.create({
        email: process.env.ADMIN_EMAIL,
        password: hashedPassword
      });
      console.log('✅ Default admin created successfully');
      console.log(`📧 Email: ${process.env.ADMIN_EMAIL}`);
      console.log(`🔑 Password: ${process.env.ADMIN_PASSWORD}`);
    } else {
      console.log('✅ Admin already exists');
    }
  } catch (error) {
    console.error('❌ Error creating admin:', error);
  }
};

mongoose.connection.once('open', () => {
  initializeAdmin();
});

// ========== HEALTH CHECK ==========
app.get('/api/health', (req, res) => {
  res.json({
    status: 'OK',
    timestamp: new Date().toISOString(),
    domain: 'fundbridge.space',
    platform: 'Zero-Fee Crowdfunding',
    gateways: ['Transak', 'MoonPay', 'Ramp', 'Wert', 'Mercuryo', 'AlchemyPay', 'Banxa']
  });
});

// ========== ADMIN ROUTES ==========

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    const token = jwt.sign(
      { id: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );
    res.json({ token, admin: { id: admin._id, email: admin.email } });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/pending-campaigns', authenticateAdmin, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ 
      status: { $in: ['Pending', 'pending'] } 
    }).sort({ createdAt: -1 });
    
    // Fix old campaigns
    const fixed = campaigns.map(c => {
      const obj = c.toObject ? c.toObject() : c;
      if (!obj.targetAmount) {
        obj.targetAmount = obj.goalAmount || 1000;
      }
      if (!obj.raisedAmount) {
        obj.raisedAmount = 0;
      }
      return obj;
    });
    
    res.json(fixed);
  } catch (error) {
    console.error('Error fetching pending campaigns:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/all-campaigns', authenticateAdmin, async (req, res) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    
    // Fix old campaigns
    const fixed = campaigns.map(c => {
      const obj = c.toObject ? c.toObject() : c;
      if (!obj.targetAmount) {
        obj.targetAmount = obj.goalAmount || 1000;
      }
      if (!obj.raisedAmount) {
        obj.raisedAmount = 0;
      }
      return obj;
    });
    
    res.json(fixed);
  } catch (error) {
    console.error('Error fetching all campaigns:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/approve-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (campaign.status !== 'Pending' && campaign.status !== 'pending') {
      return res.status(400).json({ error: 'Campaign is not pending' });
    }
    campaign.status = 'Active';
    campaign.updatedAt = new Date();
    await campaign.save();
    res.json({ message: '✅ Campaign approved successfully!', campaign });
  } catch (error) {
    console.error('Error approving campaign:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/reject-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (campaign.status !== 'Pending' && campaign.status !== 'pending') {
      return res.status(400).json({ error: 'Campaign is not pending' });
    }
    campaign.status = 'Rejected';
    campaign.updatedAt = new Date();
    await campaign.save();
    res.json({ message: '❌ Campaign rejected', campaign });
  } catch (error) {
    console.error('Error rejecting campaign:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/delete-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    await Transaction.deleteMany({ campaignId: campaign._id });
    await Campaign.findByIdAndDelete(req.params.id);
    res.json({ message: 'Campaign deleted successfully', campaignId: req.params.id });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// ========== PUBLIC ROUTES ==========

// ===== GET ACTIVE CAMPAIGNS (WITH FALLBACK FOR OLD CAMPAIGNS) =====
app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.find({ 
      status: { $in: ['Active', 'active'] } 
    }).sort({ createdAt: -1 });
    
    // Fix: Ensure targetAmount exists for old campaigns
    const fixedCampaigns = campaigns.map(c => {
      const obj = c.toObject ? c.toObject() : c;
      
      // If targetAmount doesn't exist, use goalAmount or default
      if (!obj.targetAmount && obj.goalAmount) {
        obj.targetAmount = obj.goalAmount;
      }
      if (!obj.targetAmount) {
        obj.targetAmount = 1000; // Default fallback
      }
      
      // Ensure raisedAmount exists
      if (!obj.raisedAmount) {
        obj.raisedAmount = 0;
      }
      
      return obj;
    });
    
    res.json(fixedCampaigns);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== GET SINGLE CAMPAIGN (WITH FALLBACK FOR OLD CAMPAIGNS) =====
app.get('/api/campaign/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    if (campaign.status !== 'Active' && campaign.status !== 'active' && campaign.status !== 'Pending' && campaign.status !== 'pending') {
      return res.status(403).json({ error: 'Campaign not available' });
    }
    
    const obj = campaign.toObject ? campaign.toObject() : campaign;
    
    // Fix: Ensure targetAmount exists
    if (!obj.targetAmount && obj.goalAmount) {
      obj.targetAmount = obj.goalAmount;
    }
    if (!obj.targetAmount) {
      obj.targetAmount = 1000;
    }
    if (!obj.raisedAmount) {
      obj.raisedAmount = 0;
    }
    
    res.json(obj);
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const {
      title, category, description, targetAmount, imageUrl, videoUrl,
      creatorName, creatorEmail, creatorWallet, endDate
    } = req.body;

    if (!title || !category || !description || !targetAmount || !imageUrl ||
        !creatorName || !creatorEmail || !creatorWallet || !endDate) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }

    if (!creatorWallet.startsWith('0x') || creatorWallet.length !== 42) {
      return res.status(400).json({ error: 'Invalid wallet address. Must be a valid Polygon address starting with 0x' });
    }

    if (targetAmount < 10) {
      return res.status(400).json({ error: 'Target amount must be at least $10' });
    }

    const campaign = await Campaign.create({
      title,
      category,
      description,
      targetAmount,
      goalAmount: targetAmount,
      imageUrl,
      videoUrl: videoUrl || '',
      creatorName,
      creatorEmail,
      creatorWallet,
      endDate: new Date(endDate),
      status: 'Pending'
    });

    res.status(201).json({
      message: '✅ Campaign submitted for admin review! You will be notified once approved.',
      campaign
    });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== PAYMENT INTENT - ALL 7 GATEWAYS ==========

app.post('/api/payment/intent', async (req, res) => {
  try {
    const { campaignId, amount, gateway, donorName, donorEmail } = req.body;

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'Active' && campaign.status !== 'active') {
      return res.status(400).json({ error: 'Campaign is not active' });
    }

    const cryptoAmount = amount.toFixed(2);
    const orderId = `donation_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // Save transaction record
    const transaction = await Transaction.create({
      campaignId: campaign._id,
      amount: amount,
      cryptoAmount: parseFloat(cryptoAmount),
      cryptoCurrency: 'USDC',
      donorName: donorName || 'Anonymous',
      donorEmail: donorEmail || '',
      gateway: gateway || 'Transak',
      gatewayTransactionId: orderId,
      walletAddress: campaign.creatorWallet,
      status: 'Pending'
    });

    let paymentUrl = '';
    const appUrl = process.env.APP_URL || 'https://fundbridge.space';

    switch (gateway) {
      // ===== TRANSAK =====
      case 'Transak':
        const maticAmount = (amount / 0.7).toFixed(6);
        const transakParams = {
          apiKey: process.env.TRANSAK_API_KEY,
          cryptoCurrency: 'MATIC',
          cryptoAmount: maticAmount,
          fiatCurrency: 'USD',
          fiatAmount: amount.toString(),
          network: 'polygon',
          walletAddress: campaign.creatorWallet,
          orderId: orderId,
          redirectURL: `${appUrl}/payment-success`,
          themeColor: '667eea',
          hideMenu: 'true'
        };
        const transakQuery = new URLSearchParams(transakParams).toString();
        const transakSecret = process.env.TRANSAK_API_SECRET;
        if (transakSecret) {
          const signature = crypto
            .createHmac('sha256', transakSecret)
            .update(transakQuery)
            .digest('hex');
          paymentUrl = `https://global.transak.com/?${transakQuery}&signature=${signature}`;
        } else {
          paymentUrl = `https://global.transak.com/?${transakQuery}`;
        }
        break;

      // ===== MOONPAY =====
      case 'MoonPay':
        paymentUrl = `https://buy.moonpay.com/?apiKey=${process.env.MOONPAY_API_KEY}&currencyCode=USDC&baseCurrencyAmount=${amount}&baseCurrencyCode=USD&walletAddress=${campaign.creatorWallet}&externalTransactionId=${orderId}&redirectUrl=${appUrl}/payment-success`;
        break;

      // ===== RAMP =====
      case 'Ramp':
        paymentUrl = `https://ramp.network/buy/?apiKey=${process.env.RAMP_API_KEY}&crypto=USDC&fiat=USD&fiatAmount=${amount}&userAddress=${campaign.creatorWallet}&orderId=${orderId}&redirectUrl=${appUrl}/payment-success`;
        break;

      // ===== WERT.IO =====
      case 'Wert':
        paymentUrl = `https://widget.wert.io/checkout?partner_id=${process.env.WERT_PARTNER_ID}&currency=USD&amount=${amount}&network=polygon&crypto_currency=USDC&address=${campaign.creatorWallet}&order_id=${orderId}&callback_url=${appUrl}/api/webhook/wert&success_url=${appUrl}/payment-success&cancel_url=${appUrl}/payment-cancel&theme=dark&color=667eea`;
        break;

      // ===== MERCURYO =====
      case 'Mercuryo':
        paymentUrl = `https://sandbox.mercuryo.io/payment?widget_id=${process.env.MERCURYO_WIDGET_ID}&currency=USD&amount=${amount}&crypto_currency=USDC&crypto_address=${campaign.creatorWallet}&order_id=${orderId}&callback_url=${appUrl}/api/webhook/mercuryo&success_url=${appUrl}/payment-success&cancel_url=${appUrl}/payment-cancel`;
        break;

      // ===== ALCHEMY PAY =====
      case 'AlchemyPay':
        paymentUrl = `https://checkout.alchemypay.com/pay?app_id=${process.env.ALCHEMYPAY_APP_ID}&amount=${amount}&currency=USD&crypto=USDC&network=polygon&wallet=${campaign.creatorWallet}&order_id=${orderId}&callback_url=${appUrl}/api/webhook/alchemypay&return_url=${appUrl}/payment-success`;
        break;

      // ===== BANXA =====
      case 'Banxa':
        paymentUrl = `https://checkout.banxa.com/?api_key=${process.env.BANXA_API_KEY}&amount=${amount}&currency=USD&coin=USDC&network=polygon&wallet=${campaign.creatorWallet}&order_id=${orderId}&webhook_url=${appUrl}/api/webhook/banxa&redirect_url=${appUrl}/payment-success`;
        break;

      default:
        return res.status(400).json({ error: 'Invalid gateway' });
    }

    res.json({
      success: true,
      paymentUrl,
      orderId,
      transactionId: transaction._id,
      cryptoAmount: parseFloat(cryptoAmount),
      walletAddress: campaign.creatorWallet,
      gateway: gateway
    });

  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({ error: 'Failed to create payment intent: ' + error.message });
  }
});

// ========== WEBHOOK HANDLERS - ALL 7 GATEWAYS ==========

// Transak Webhook
app.post('/api/webhook/transak', async (req, res) => {
  try {
    const { orderId, status, amount, walletAddress, transactionHash } = req.body;
    await processPaymentWebhook(orderId, status, amount, walletAddress, transactionHash, 'Transak');
    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Transak webhook error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// MoonPay Webhook
app.post('/api/webhook/moonpay', async (req, res) => {
  try {
    const { externalTransactionId, status, baseCurrencyAmount, walletAddress, transactionHash } = req.body;
    await processPaymentWebhook(externalTransactionId, status, baseCurrencyAmount, walletAddress, transactionHash, 'MoonPay');
    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('MoonPay webhook error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// Ramp Webhook
app.post('/api/webhook/ramp', async (req, res) => {
  try {
    const { orderId, status, fiatAmount, cryptoAddress, txHash } = req.body;
    await processPaymentWebhook(orderId, status, fiatAmount, cryptoAddress, txHash, 'Ramp');
    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Ramp webhook error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// Wert.io Webhook
app.post('/api/webhook/wert', async (req, res) => {
  try {
    const { order_id, status, amount, address, tx_hash } = req.body;
    await processPaymentWebhook(order_id, status, amount, address, tx_hash, 'Wert');
    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Wert webhook error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// Mercuryo Webhook
app.post('/api/webhook/mercuryo', async (req, res) => {
  try {
    const { order_id, status, amount, crypto_address, tx_hash } = req.body;
    await processPaymentWebhook(order_id, status, amount, crypto_address, tx_hash, 'Mercuryo');
    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Mercuryo webhook error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// AlchemyPay Webhook
app.post('/api/webhook/alchemypay', async (req, res) => {
  try {
    const { order_id, status, amount, wallet_address, tx_hash } = req.body;
    await processPaymentWebhook(order_id, status, amount, wallet_address, tx_hash, 'AlchemyPay');
    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('AlchemyPay webhook error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// Banxa Webhook
app.post('/api/webhook/banxa', async (req, res) => {
  try {
    const { order_id, status, amount, wallet, tx_hash } = req.body;
    await processPaymentWebhook(order_id, status, amount, wallet, tx_hash, 'Banxa');
    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Banxa webhook error:', error);
    res.status(500).json({ error: 'Webhook error' });
  }
});

// ========== SHARED WEBHOOK PROCESSOR ==========
async function processPaymentWebhook(orderId, status, amount, walletAddress, txHash, gateway) {
  console.log(`📥 ${gateway} Webhook received:`, { orderId, status, amount, walletAddress, txHash });

  const transaction = await Transaction.findOne({ gatewayTransactionId: orderId });
  if (!transaction) {
    console.log('❌ Transaction not found:', orderId);
    return;
  }

  if (status === 'success' || status === 'completed' || status === 'COMPLETED' || status === 'SUCCESS') {
    transaction.status = 'Completed';
    transaction.txHash = txHash || '';
    await transaction.save();

    const campaign = await Campaign.findById(transaction.campaignId);
    if (campaign) {
      campaign.raisedAmount += transaction.amount;
      campaign.donations.push({
        donorName: transaction.donorName || 'Anonymous',
        amount: transaction.amount,
        transactionId: transaction.gatewayTransactionId,
        txHash: txHash || '',
        gateway: transaction.gateway
      });

      if (campaign.raisedAmount >= campaign.targetAmount) {
        campaign.status = 'Completed';
      }

      await campaign.save();
      console.log(`✅ Donation recorded for campaign: ${campaign.title}`);
    }
  } else if (status === 'failed' || status === 'cancelled' || status === 'FAILED' || status === 'CANCELLED') {
    transaction.status = 'Failed';
    await transaction.save();
    console.log(`❌ Transaction failed: ${orderId}`);
  }
}

// ========== PAYMENT SUCCESS/CANCEL ==========

app.get('/payment-success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful - FundBridge</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        .gradient-bg { background: linear-gradient(135deg, #667eea 0%, #764ba2 100%); }
      </style>
    </head>
    <body>
      <div class="min-h-screen gradient-bg flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-md w-full p-8 text-center shadow-2xl">
          <div class="text-6xl mb-4">🎉</div>
          <h1 class="text-3xl font-bold text-gray-800 mb-2">Payment Successful!</h1>
          <p class="text-gray-600 mb-4">Thank you for your donation. 100% of your funds go directly to the campaign creator.</p>
          <div class="bg-green-50 p-4 rounded-lg mb-6">
            <p class="text-green-700 font-semibold">✅ Your donation has been confirmed on the blockchain.</p>
          </div>
          <a href="/" class="inline-block bg-purple-600 text-white px-8 py-3 rounded-full font-semibold hover:shadow-lg transition-all duration-200">
            <i class="fas fa-home mr-2"></i>Return to Home
          </a>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/payment-cancel', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Cancelled - FundBridge</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script src="https://cdn.tailwindcss.com"></script>
    </head>
    <body>
      <div class="min-h-screen bg-gray-100 flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-md w-full p-8 text-center shadow-2xl">
          <div class="text-6xl mb-4">⚠️</div>
          <h1 class="text-3xl font-bold text-gray-800 mb-2">Payment Cancelled</h1>
          <p class="text-gray-600 mb-6">Your donation was cancelled. No funds have been transferred.</p>
          <a href="/" class="inline-block bg-purple-600 text-white px-8 py-3 rounded-full font-semibold hover:shadow-lg transition-all duration-200">
            <i class="fas fa-home mr-2"></i>Return to Home
          </a>
        </div>
      </div>
    </body>
    </html>
  `);
});

// ========== START SERVER ==========

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Website: https://fundbridge.space`);
  console.log(`🔐 Admin: https://fundbridge.space/admin.html`);
  console.log(`💚 Health: https://fundbridge.space/api/health`);
  console.log(`💰 Platform: ZERO-FEE Crowdfunding`);
  console.log(`🔄 Gateways: Transak, MoonPay, Ramp, Wert, Mercuryo, AlchemyPay, Banxa`);
  console.log(`🔑 Admin Email: ${process.env.ADMIN_EMAIL}`);
});
