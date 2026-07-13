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
  origin: ['https://fundbridge.space', 'http://localhost:5000', 'https://crowd-funding-9pug.onrender.com', 'http://localhost:3000'],
  credentials: true
}));
app.use(express.json({ limit: '50mb' }));

// Serve static files from 'public' folder
app.use(express.static(path.join(__dirname, 'public')));

// Serve HTML files
app.get('/', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

app.get('/admin.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'admin.html'));
});

app.get('/privacy.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'privacy.html'));
});

app.get('/terms.html', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'terms.html'));
});

console.log('📁 Serving files from:', path.join(__dirname, 'public'));

// MongoDB Connection
mongoose.connect(process.env.MONGODB_URI, {
  useNewUrlParser: true,
  useUnifiedTopology: true,
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

// ========== ROUTES ==========

// Health Check
app.get('/api/health', (req, res) => {
  res.json({ 
    status: 'OK', 
    timestamp: new Date().toISOString(),
    domain: 'fundbridge.space',
    contractAddress: '0xf3C017BdCCa5f9178Aed2f5B1EaDab76373AF04B'
  });
});

// ===== ADMIN ROUTES =====

app.post('/api/admin/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    console.log('Login attempt for:', email);

    const admin = await Admin.findOne({ email });
    if (!admin) {
      console.log('Admin not found:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const isValid = await bcrypt.compare(password, admin.password);
    if (!isValid) {
      console.log('Invalid password for:', email);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: admin._id, email: admin.email },
      process.env.JWT_SECRET,
      { expiresIn: '7d' }
    );

    console.log('Login successful for:', email);
    res.json({
      token,
      admin: {
        id: admin._id,
        email: admin.email
      }
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/pending-campaigns', authenticateAdmin, async (req, res) => {
  try {
    const campaigns = await Campaign.find({ status: 'Pending' })
      .sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching pending campaigns:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/admin/all-campaigns', authenticateAdmin, async (req, res) => {
  try {
    const campaigns = await Campaign.find()
      .sort({ createdAt: -1 });
    res.json(campaigns);
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

    if (campaign.status !== 'Pending') {
      return res.status(400).json({ error: 'Campaign is not pending' });
    }

    campaign.status = 'Active';
    campaign.updatedAt = new Date();
    await campaign.save();

    res.json({ message: 'Campaign approved successfully', campaign });
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

    if (campaign.status !== 'Pending') {
      return res.status(400).json({ error: 'Campaign is not pending' });
    }

    campaign.status = 'Rejected';
    campaign.updatedAt = new Date();
    await campaign.save();

    res.json({ message: 'Campaign rejected successfully', campaign });
  } catch (error) {
    console.error('Error rejecting campaign:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== DELETE CAMPAIGN =====

app.delete('/api/admin/delete-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    await Transaction.deleteMany({ campaignId: campaign._id });
    await Campaign.findByIdAndDelete(req.params.id);

    res.json({ 
      message: 'Campaign and all related transactions deleted successfully',
      campaignId: req.params.id
    });
  } catch (error) {
    console.error('Error deleting campaign:', error);
    res.status(500).json({ error: 'Failed to delete campaign' });
  }
});

// ===== PUBLIC ROUTES =====

app.get('/api/campaigns', async (req, res) => {
  try {
    const campaigns = await Campaign.find({ status: 'Active' })
      .sort({ createdAt: -1 });
    res.json(campaigns);
  } catch (error) {
    console.error('Error fetching campaigns:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.get('/api/campaign/:id', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json(campaign);
  } catch (error) {
    console.error('Error fetching campaign:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/campaigns', async (req, res) => {
  try {
    const {
      title,
      category,
      description,
      goalAmount,
      imageUrl,
      videoUrl,
      creatorName,
      creatorEmail,
      creatorWallet,
      endDate
    } = req.body;

    if (!title || !category || !description || !goalAmount || !imageUrl || 
        !creatorName || !creatorEmail || !creatorWallet || !endDate) {
      return res.status(400).json({ error: 'All required fields must be filled' });
    }

    if (!ethers.isAddress(creatorWallet)) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }

    const campaign = await Campaign.create({
      title,
      category,
      description,
      goalAmount,
      imageUrl,
      videoUrl: videoUrl || '',
      creatorName,
      creatorEmail,
      creatorWallet,
      endDate: new Date(endDate),
      status: 'Pending'
    });

    res.status(201).json({
      message: 'Campaign created successfully! It will be visible after admin approval.',
      campaign
    });
  } catch (error) {
    console.error('Error creating campaign:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ===== PAYMENT ROUTES =====

app.post('/api/payment/intent', async (req, res) => {
  try {
    const { campaignId, amount, gateway, donorName, donorEmail } = req.body;

    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    if (campaign.status !== 'Active') {
      return res.status(400).json({ error: 'Campaign is not active' });
    }

    // Calculate crypto amount with a realistic MATIC/USD rate
    // In production, you should use a price oracle or API
    const maticRate = 0.7; // 1 MATIC = $0.70 USD
    const cryptoAmount = (amount / maticRate).toFixed(6);
    const transactionId = uuidv4();

    const transaction = await Transaction.create({
      campaignId,
      amount,
      cryptoAmount: parseFloat(cryptoAmount),
      cryptoCurrency: 'MATIC',
      donorName: donorName || 'Anonymous',
      donorEmail: donorEmail || '',
      gateway,
      gatewayTransactionId: transactionId,
      walletAddress: campaign.creatorWallet,
      status: 'Pending'
    });

    let paymentUrl = '';
    let orderId = `txn_${Date.now()}`;

    // Determine the base URL based on environment
    const baseUrl = process.env.NODE_ENV === 'production' 
      ? 'https://fundbridge.space' 
      : 'http://localhost:5000';

    switch (gateway) {
      case 'Transak':
        paymentUrl = `https://global.transak.com/?apiKey=${process.env.TRANSFER_API_KEY}&cryptoCurrency=MATIC&cryptoAmount=${cryptoAmount}&fiatCurrency=USD&fiatAmount=${amount}&network=polygon&walletAddress=${campaign.creatorWallet}&orderId=${orderId}&redirectURL=${baseUrl}/payment-success?orderId=${orderId}`;
        break;
      case 'MoonPay':
        paymentUrl = `https://buy.moonpay.com/?apiKey=${process.env.MOONPAY_API_KEY}&currencyCode=MATIC&baseCurrencyAmount=${amount}&baseCurrencyCode=USD&walletAddress=${campaign.creatorWallet}&externalTransactionId=${orderId}`;
        break;
      case 'Ramp':
        paymentUrl = `https://ramp.network/buy/?apiKey=${process.env.RAMP_API_KEY}&crypto=MATIC&fiat=USD&fiatAmount=${amount}&userAddress=${campaign.creatorWallet}&orderId=${orderId}`;
        break;
      default:
        return res.status(400).json({ error: 'Invalid gateway' });
    }

    res.json({
      transactionId: transaction._id,
      orderId,
      paymentUrl,
      cryptoAmount: parseFloat(cryptoAmount),
      transaction
    });

  } catch (error) {
    console.error('Payment intent error:', error);
    res.status(500).json({ error: 'Server error: ' + error.message });
  }
});

// Webhook endpoint for payment confirmation
app.post('/api/webhook/payment', async (req, res) => {
  try {
    const { transactionId, status, gatewayTransactionId, amount, donorName } = req.body;

    // Find the transaction
    let transaction = await Transaction.findOne({ 
      gatewayTransactionId: transactionId || gatewayTransactionId 
    });

    if (!transaction) {
      // If transaction not found, create a new one
      const campaign = await Campaign.findOne({ creatorWallet: req.body.walletAddress });
      if (campaign) {
        transaction = await Transaction.create({
          campaignId: campaign._id,
          amount: amount || 0,
          cryptoAmount: (amount || 0) / 0.7,
          cryptoCurrency: 'MATIC',
          donorName: donorName || 'Anonymous',
          donorEmail: '',
          gateway: 'Transak',
          gatewayTransactionId: transactionId || gatewayTransactionId,
          walletAddress: req.body.walletAddress,
          status: status === 'COMPLETED' || status === 'SUCCESS' ? 'Completed' : 'Failed'
        });
      } else {
        return res.status(404).json({ error: 'Transaction or campaign not found' });
      }
    }

    if (status === 'COMPLETED' || status === 'SUCCESS') {
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
        await campaign.save();

        if (campaign.raisedAmount >= campaign.goalAmount) {
          campaign.status = 'Completed';
          await campaign.save();
        }
      }
    } else if (status === 'FAILED' || status === 'CANCELLED') {
      transaction.status = 'Failed';
      await transaction.save();
    }

    res.json({ message: 'Webhook processed successfully' });
  } catch (error) {
    console.error('Webhook error:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// Payment success redirect
app.get('/payment-success', (req, res) => {
  res.send(`
    <!DOCTYPE html>
    <html>
    <head>
      <title>Payment Successful - FundBridge</title>
      <meta name="viewport" content="width=device-width, initial-scale=1.0">
      <script src="https://cdn.tailwindcss.com"></script>
      <style>
        @import url('https://fonts.googleapis.com/css2?family=Inter:wght@300;400;500;600;700;800&display=swap');
        * { font-family: 'Inter', sans-serif; }
        .gradient-bg {
          background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        }
      </style>
    </head>
    <body>
      <div class="min-h-screen gradient-bg flex items-center justify-center p-4">
        <div class="bg-white rounded-2xl max-w-md w-full p-8 text-center shadow-2xl">
          <div class="text-6xl mb-4">🎉</div>
          <h1 class="text-3xl font-bold text-gray-800 mb-2">Payment Successful!</h1>
          <p class="text-gray-600 mb-4">Thank you for your donation. Your support means the world to us.</p>
          <div class="bg-green-50 p-4 rounded-lg mb-6">
            <p class="text-green-700 font-semibold">Your transaction has been confirmed.</p>
          </div>
          <a href="/" class="inline-block bg-gradient-to-r from-purple-600 to-indigo-600 text-white px-8 py-3 rounded-full font-semibold hover:shadow-lg transition-all duration-200">
            <i class="fas fa-home mr-2"></i>Return to Home
          </a>
          <p class="text-sm text-gray-500 mt-4">You can close this window now.</p>
        </div>
      </div>
    </body>
    </html>
  `);
});

app.get('/api/campaign/:id/donations', async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }
    res.json(campaign.donations);
  } catch (error) {
    console.error('Error fetching donations:', error);
    res.status(500).json({ error: 'Server error' });
  }
});

// ========== SMART CONTRACT ROUTES ==========

// Get contract info
app.get('/api/contract/info', async (req, res) => {
  try {
    res.json({
      address: process.env.CONTRACT_ADDRESS || '0xf3C017BdCCa5f9178Aed2f5B1EaDab76373AF04B',
      network: 'Polygon',
      chainId: 137
    });
  } catch (error) {
    console.error('Error getting contract info:', error);
    res.status(500).json({ error: 'Failed to get contract info' });
  }
});

// Lock Funds
app.post('/api/contract/lock', async (req, res) => {
  try {
    const { campaignId, amount } = req.body;
    
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Check if private key is set (not the default)
    if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return res.status(400).json({ 
        error: 'Contract locking is not configured. Please set PRIVATE_KEY in .env file.',
        fallback: true
      });
    }

    const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    const contractABI = [
      "function lockFunds(address campaignWallet, uint256 amount) external payable",
      "event FundsLocked(address indexed campaignWallet, uint256 amount)"
    ];
    
    const contract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS || '0xf3C017BdCCa5f9178Aed2f5B1EaDab76373AF04B',
      contractABI,
      wallet
    );
    const amountInWei = ethers.parseEther(amount.toString());
    
    const tx = await contract.lockFunds(campaign.creatorWallet, amountInWei, {
      value: amountInWei
    });
    
    await tx.wait();
    
    res.json({
      message: 'Funds locked successfully',
      transactionHash: tx.hash,
      contractAddress: process.env.CONTRACT_ADDRESS || '0xf3C017BdCCa5f9178Aed2f5B1EaDab76373AF04B'
    });
  } catch (error) {
    console.error('Lock funds error:', error);
    res.status(500).json({ error: 'Failed to lock funds: ' + error.message });
  }
});

// Clear Funds
app.post('/api/contract/clear', async (req, res) => {
  try {
    const { campaignId } = req.body;
    
    const campaign = await Campaign.findById(campaignId);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Check if private key is set (not the default)
    if (!process.env.PRIVATE_KEY || process.env.PRIVATE_KEY === '0x0000000000000000000000000000000000000000000000000000000000000000') {
      return res.status(400).json({ 
        error: 'Contract clearing is not configured. Please set PRIVATE_KEY in .env file.',
        fallback: true
      });
    }

    const provider = new ethers.JsonRpcProvider(process.env.POLYGON_RPC_URL);
    const wallet = new ethers.Wallet(process.env.PRIVATE_KEY, provider);
    
    const contractABI = [
      "function clearFunds(address campaignWallet) external",
      "event FundsCleared(address indexed campaignWallet, uint256 amount)"
    ];
    
    const contract = new ethers.Contract(
      process.env.CONTRACT_ADDRESS || '0xf3C017BdCCa5f9178Aed2f5B1EaDab76373AF04B',
      contractABI,
      wallet
    );
    const tx = await contract.clearFunds(campaign.creatorWallet);
    await tx.wait();
    
    res.json({
      message: 'Funds cleared successfully',
      transactionHash: tx.hash,
      contractAddress: process.env.CONTRACT_ADDRESS || '0xf3C017BdCCa5f9178Aed2f5B1EaDab76373AF04B'
    });
  } catch (error) {
    console.error('Clear funds error:', error);
    res.status(500).json({ error: 'Failed to clear funds: ' + error.message });
  }
});

// ========== START SERVER ==========

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Website: https://fundbridge.space`);
  console.log(`🔐 Admin: https://fundbridge.space/admin.html`);
  console.log(`📋 Privacy: https://fundbridge.space/privacy.html`);
  console.log(`📋 Terms: https://fundbridge.space/terms.html`);
  console.log(`💚 Health: https://fundbridge.space/api/health`);
  console.log(`📦 Contract: ${process.env.CONTRACT_ADDRESS || '0xf3C017BdCCa5f9178Aed2f5B1EaDab76373AF04B'}`);
});
