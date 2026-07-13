require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { ethers } = require('ethers');
const path = require('path');
const crypto = require('crypto');

const app = express();

// Middleware
app.use(cors({
  origin: ['https://fundbridge.space', 'http://localhost:5000', 'https://crowd-funding-9pug.onrender.com', 'https://*.onrender.com'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Routes
app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

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
  goalAmount: { type: Number, required: true, min: 10 },
  raisedAmount: { type: Number, default: 0 },
  imageUrl: { type: String, required: true },
  videoUrl: { type: String, default: '' },
  creatorName: { type: String, required: true },
  creatorEmail: { type: String, required: true },
  creatorWallet: { type: String, required: true },
  status: { type: String, enum: ['Pending', 'Active', 'Completed', 'Rejected'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now },
  updatedAt: { type: Date, default: Date.now },
  endDate: { type: Date, required: true },
  donations: [{
    donorName: { type: String, default: 'Anonymous' },
    amount: { type: Number, required: true },
    transactionId: { type: String, required: true },
    gateway: { type: String, enum: ['Transak', 'MoonPay', 'Ramp'], required: true },
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
  cryptoCurrency: { type: String, default: 'MATIC' },
  donorEmail: { type: String, default: '' },
  donorName: { type: String, default: 'Anonymous' },
  gateway: { type: String, enum: ['Transak', 'MoonPay', 'Ramp'], required: true },
  gatewayTransactionId: { type: String, required: true },
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
    domain: 'fundbridge.space'
  });
});

// ========== TRANSAK SECURE WIDGET URL ==========
app.post('/api/transak/widget-url', async (req, res) => {
  try {
    const { amount, walletAddress, orderId, donorName, donorEmail } = req.body;
    
    console.log('🔑 TRANSAK_API_KEY:', process.env.TRANSAK_API_KEY ? '✅ Found' : '❌ MISSING');
    console.log('🔐 TRANSAK_API_SECRET:', process.env.TRANSAK_API_SECRET ? '✅ Found' : '❌ MISSING');
    
    if (!amount || !walletAddress) {
      return res.status(400).json({ error: 'Amount and wallet address required' });
    }

    if (amount < 1) {
      return res.status(400).json({ error: 'Amount must be at least $1' });
    }

    const maticRate = 0.7;
    const cryptoAmount = (amount / maticRate).toFixed(6);
    const orderIdFinal = orderId || `donation_${Date.now()}_${Math.random().toString(36).substr(2, 6)}`;

    // Build parameters
    const params = {
      apiKey: process.env.TRANSAK_API_KEY,
      cryptoCurrency: 'MATIC',
      cryptoAmount: cryptoAmount,
      fiatCurrency: 'USD',
      fiatAmount: amount.toString(),
      network: 'polygon',
      walletAddress: walletAddress,
      orderId: orderIdFinal,
      redirectURL: 'https://fundbridge.space/payment-success',
      themeColor: '667eea',
      hideMenu: 'true',
      isAutoPayment: 'true'
    };

    // Add user data if provided
    if (donorName || donorEmail) {
      const userData = {};
      if (donorName) userData.firstName = donorName;
      if (donorEmail) userData.email = donorEmail;
      params.userData = JSON.stringify(userData);
    }

    // Generate query string
    const queryString = new URLSearchParams(params).toString();

    // Generate signature using API Secret
    const apiSecret = process.env.TRANSAK_API_SECRET;
    if (!apiSecret) {
      console.error('❌ TRANSAK_API_SECRET not found');
      return res.status(500).json({ error: 'Transak API Secret not configured' });
    }

    const signature = crypto
      .createHmac('sha256', apiSecret)
      .update(queryString)
      .digest('hex');

    const secureUrl = `https://global.transak.com/?${queryString}&signature=${signature}`;

    console.log('✅ Transak Secure URL generated for order:', orderIdFinal);

    res.json({
      success: true,
      paymentUrl: secureUrl,
      orderId: orderIdFinal,
      cryptoAmount: parseFloat(cryptoAmount),
      amount: amount
    });

  } catch (error) {
    console.error('❌ Transak error:', error);
    res.status(500).json({ error: 'Failed to generate payment URL: ' + error.message });
  }
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
    const campaigns = await Campaign.find({ status: 'Pending' }).sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/all-campaigns', authenticateAdmin, async (req, res) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/approve-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'Pending') return res.status(400).json({ error: 'Campaign is not pending' });
    campaign.status = 'Active';
    campaign.updatedAt = new Date();
    await campaign.save();
    res.json({ message: 'Campaign approved successfully', campaign });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.put('/api/admin/reject-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'Pending') return res.status(400).json({ error: 'Campaign is not pending' });
    campaign.status = 'Rejected';
    campaign.updatedAt = new Date();
    await campaign.save();
    res.json({ message: 'Campaign rejected successfully', campaign });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.delete('/api/admin/delete-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    await Transaction.deleteMany({ campaignId: campaign._id });
    await Campaign.findByIdAndDelete(req.params.id);
    res.json({ message: 'Campaign deleted successfully', campaignId: req.params.id });
  } catch (error) {
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// ========== PUBLIC ROUTES ==========
app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.find({ status: 'Active' }).sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/campaign/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    res.json(campaign);
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const { title, category, description, goalAmount, imageUrl, videoUrl, creatorName, creatorEmail, creatorWallet, endDate } = req.body;
    if (!title || !category || !description || !goalAmount || !imageUrl || !creatorName || !creatorEmail || !creatorWallet || !endDate) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }
    if (!ethers.isAddress(creatorWallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    if (goalAmount < 10) {
      return res.status(400).json({ error: 'Goal amount must be at least $10' });
    }
    const campaign = await Campaign.create({
      title, category, description, goalAmount, imageUrl, videoUrl: videoUrl || '',
      creatorName, creatorEmail, creatorWallet, endDate: new Date(endDate), status: 'Pending'
    });
    res.status(201).json({ message: 'Campaign created successfully!', campaign });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== RECORD DONATION ==========
app.post('/api/campaigns/:id/donation', async (req, res) => {
  try {
    const { amount, transactionId, gateway, donorName, donorEmail } = req.body;
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    
    campaign.raisedAmount += amount;
    campaign.donations.push({
      donorName: donorName || 'Anonymous',
      amount: amount,
      transactionId: transactionId || `txn_${Date.now()}`,
      gateway: gateway || 'Transak'
    });
    if (campaign.raisedAmount >= campaign.goalAmount) {
      campaign.status = 'Completed';
    }
    await campaign.save();
    res.json({ message: 'Donation recorded successfully', campaign });
  } catch (error) {
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== WEBHOOK ==========
app.post('/api/webhook/payment', async (req, res) => {
  try {
    const { transactionId, status, amount, donorName, walletAddress } = req.body;
    let transaction = await Transaction.findOne({ gatewayTransactionId: transactionId });
    if (!transaction) {
      const campaign = await Campaign.findOne({ creatorWallet: walletAddress });
      if (campaign) {
        transaction = await Transaction.create({
          campaignId: campaign._id,
          amount: amount || 0,
          cryptoAmount: (amount || 0) / 0.7,
          donorName: donorName || 'Anonymous',
          gateway: 'Transak',
          gatewayTransactionId: transactionId,
          walletAddress: walletAddress,
          status: status === 'COMPLETED' ? 'Completed' : 'Failed'
        });
      }
    }
    if (transaction && (status === 'COMPLETED' || status === 'SUCCESS')) {
      transaction.status = 'Completed';
      await transaction.save();
      const campaign = await Campaign.findById(transaction.campaignId);
      if (campaign) {
        campaign.raisedAmount += transaction.amount;
        campaign.donations.push({
          donorName: transaction.donorName || 'Anonymous',
          amount: transaction.amount,
          transactionId: transaction.gatewayTransactionId,
          gateway: transaction.gateway
        });
        if (campaign.raisedAmount >= campaign.goalAmount) campaign.status = 'Completed';
        await campaign.save();
      }
    }
    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    res.status(500).json({ error: 'Webhook error' });
  }
});

// ========== PAYMENT SUCCESS ==========
app.get('/payment-success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful - FundBridge</title>
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
          <p class="text-gray-600 mb-4">Thank you for your donation!</p>
          <a href="/" class="inline-block bg-purple-600 text-white px-8 py-3 rounded-full font-semibold hover:shadow-lg">Return Home</a>
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
  console.log(`🔑 Transak API Key: ${process.env.TRANSAK_API_KEY ? '✅ Configured' : '❌ Missing'}`);
  console.log(`🔐 Transak API Secret: ${process.env.TRANSAK_API_SECRET ? '✅ Configured' : '❌ Missing'}`);
});
