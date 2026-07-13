require('dotenv').config();
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const { v4: uuidv4 } = require('uuid');
const { ethers } = require('ethers');
const path = require('path');

const app = express();

// Middleware
app.use(cors({
  origin: ['https://fundbridge.space', 'http://localhost:5000', 'https://crowd-funding-9pug.onrender.com'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

app.get('/', (req, res) => res.sendFile(path.join(__dirname, 'public', 'index.html')));
app.get('/admin.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'admin.html')));
app.get('/privacy.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'privacy.html')));
app.get('/terms.html', (req, res) => res.sendFile(path.join(__dirname, 'public', 'terms.html')));

console.log('📁 Serving files from:', path.join(__dirname, 'public'));

// MongoDB
mongoose.connect(process.env.MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(() => console.log('✅ MongoDB Connected'))
  .catch(err => console.error('❌ MongoDB Error:', err));

// ===== SCHEMAS =====
const campaignSchema = new mongoose.Schema({
  title: { type: String, required: true },
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
  password: { type: String, required: true }
});

const transactionSchema = new mongoose.Schema({
  campaignId: { type: mongoose.Schema.Types.ObjectId, ref: 'Campaign', required: true },
  amount: { type: Number, required: true },
  cryptoAmount: { type: Number, required: true },
  donorName: { type: String, default: 'Anonymous' },
  donorEmail: { type: String, default: '' },
  gateway: { type: String, enum: ['Transak', 'MoonPay', 'Ramp'], required: true },
  gatewayTransactionId: { type: String, required: true },
  walletAddress: { type: String, required: true },
  status: { type: String, enum: ['Pending', 'Completed', 'Failed'], default: 'Pending' },
  createdAt: { type: Date, default: Date.now }
});

const Campaign = mongoose.model('Campaign', campaignSchema);
const Admin = mongoose.model('Admin', adminSchema);
const Transaction = mongoose.model('Transaction', transactionSchema);

// ===== AUTH =====
const authenticateAdmin = async (req, res, next) => {
  try {
    const token = req.headers.authorization?.split(' ')[1];
    if (!token) return res.status(401).json({ error: 'Authentication required' });
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    const admin = await Admin.findById(decoded.id);
    if (!admin) return res.status(401).json({ error: 'Admin not found' });
    req.admin = admin;
    next();
  } catch (error) {
    res.status(401).json({ error: 'Invalid token' });
  }
};

// ===== INIT ADMIN =====
const initializeAdmin = async () => {
  try {
    const exists = await Admin.findOne({ email: process.env.ADMIN_EMAIL });
    if (!exists) {
      const hashed = await bcrypt.hash(process.env.ADMIN_PASSWORD, 10);
      await Admin.create({ email: process.env.ADMIN_EMAIL, password: hashed });
      console.log('✅ Admin created');
    }
  } catch (e) { console.error('Admin init error:', e); }
};
mongoose.connection.once('open', initializeAdmin);

// ===== HEALTH =====
app.get('/api/health', (req, res) => {
  res.json({ status: 'OK', timestamp: new Date().toISOString() });
});

// ===== ADMIN LOGIN =====
app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const admin = await Admin.findOne({ email });
    if (!admin) return res.status(401).json({ error: 'Invalid credentials' });
    const valid = await bcrypt.compare(password, admin.password);
    if (!valid) return res.status(401).json({ error: 'Invalid credentials' });
    const token = jwt.sign({ id: admin._id, email: admin.email }, process.env.JWT_SECRET, { expiresIn: '7d' });
    res.json({ token, admin: { id: admin._id, email: admin.email } });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ===== ADMIN CAMPAIGNS =====
app.get('/api/admin/pending-campaigns', authenticateAdmin, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ status: 'Pending' }).sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/admin/all-campaigns', authenticateAdmin, async (req, res) => {
  try {
    const campaigns = await Campaign.find().sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ===== APPROVE =====
app.put('/api/admin/approve-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    if (campaign.status !== 'Pending') return res.status(400).json({ error: 'Not pending' });
    campaign.status = 'Active';
    campaign.updatedAt = new Date();
    await campaign.save();
    res.json({ message: 'Approved', campaign });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ===== REJECT =====
app.put('/api/admin/reject-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    if (campaign.status !== 'Pending') return res.status(400).json({ error: 'Not pending' });
    campaign.status = 'Rejected';
    campaign.updatedAt = new Date();
    await campaign.save();
    res.json({ message: 'Rejected', campaign });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ===== DELETE =====
app.delete('/api/admin/delete-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    await Transaction.deleteMany({ campaignId: campaign._id });
    await Campaign.findByIdAndDelete(req.params.id);
    res.json({ message: 'Deleted', campaignId: req.params.id });
  } catch (e) { res.status(500).json({ error: 'Delete failed' }); }
});

// ===== PUBLIC CAMPAIGNS =====
app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.find({ status: 'Active' }).sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

app.get('/api/campaign/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Not found' });
    res.json(campaign);
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ===== CREATE CAMPAIGN =====
app.post('/api/campaigns', async (req, res) => {
  try {
    const { title, category, description, goalAmount, imageUrl, videoUrl, creatorName, creatorEmail, creatorWallet, endDate } = req.body;
    if (!title || !category || !description || !goalAmount || !imageUrl || !creatorName || !creatorEmail || !creatorWallet || !endDate) {
      return res.status(400).json({ error: 'All fields required' });
    }
    if (!ethers.isAddress(creatorWallet)) return res.status(400).json({ error: 'Invalid wallet' });
    const campaign = await Campaign.create({
      title, category, description, goalAmount, imageUrl, videoUrl: videoUrl || '',
      creatorName, creatorEmail, creatorWallet, endDate: new Date(endDate), status: 'Pending'
    });
    res.status(201).json({ message: 'Campaign created', campaign });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ===== PAYMENT INTENT =====
app.post('/api/payment/intent', async (req, res) => {
  try {
    const { campaignId, amount, gateway, donorName, donorEmail } = req.body;
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    if (campaign.status !== 'Active') return res.status(400).json({ error: 'Campaign not active' });

    const cryptoAmount = (amount / 0.7).toFixed(6);
    const orderId = `txn_${Date.now()}`;
    const transaction = await Transaction.create({
      campaignId, amount, cryptoAmount: parseFloat(cryptoAmount),
      donorName: donorName || 'Anonymous', donorEmail: donorEmail || '',
      gateway, gatewayTransactionId: orderId, walletAddress: campaign.creatorWallet, status: 'Pending'
    });

    let paymentUrl = '';
    const baseUrl = process.env.NODE_ENV === 'production' ? 'https://fundbridge.space' : 'http://localhost:5000';

    switch (gateway) {
      case 'MoonPay':
        paymentUrl = `https://buy.moonpay.com/?apiKey=${process.env.MOONPAY_API_KEY}&currencyCode=MATIC&baseCurrencyAmount=${amount}&baseCurrencyCode=USD&walletAddress=${campaign.creatorWallet}&externalTransactionId=${orderId}`;
        break;
      case 'Ramp':
        paymentUrl = `https://ramp.network/buy/?apiKey=${process.env.RAMP_API_KEY}&crypto=MATIC&fiat=USD&fiatAmount=${amount}&userAddress=${campaign.creatorWallet}&orderId=${orderId}`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid gateway' });
    }

    res.json({ transactionId: transaction._id, orderId, paymentUrl, cryptoAmount: parseFloat(cryptoAmount), transaction });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ===== RECORD DONATION (for Transak webhook) =====
app.post('/api/campaigns/:id/donation', async (req, res) => {
  try {
    const { amount, transactionId, gateway, donorName, donorEmail } = req.body;
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) return res.status(404).json({ error: 'Campaign not found' });
    
    campaign.raisedAmount += amount;
    campaign.donations.push({
      donorName: donorName || 'Anonymous',
      amount,
      transactionId: transactionId || `txn_${Date.now()}`,
      gateway: gateway || 'Transak'
    });
    if (campaign.raisedAmount >= campaign.goalAmount) {
      campaign.status = 'Completed';
    }
    await campaign.save();
    res.json({ message: 'Donation recorded', campaign });
  } catch (e) { res.status(500).json({ error: 'Server error' }); }
});

// ===== WEBHOOK =====
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
    res.json({ message: 'Webhook processed' });
  } catch (e) { res.status(500).json({ error: 'Webhook error' }); }
});

// ===== PAYMENT SUCCESS =====
app.get('/payment-success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head><title>Payment Success</title><script src="https://cdn.tailwindcss.com"></script></head>
    <body>
      <div class="min-h-screen gradient-bg flex items-center justify-center p-4" style="background:linear-gradient(135deg,#667eea 0%,#764ba2 100%)">
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

// ===== START =====
const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 https://fundbridge.space`);
});
