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
    domain: 'fundbridge.space'
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

// ===== DELETE CAMPAIGN (New Feature) =====

app.delete('/api/admin/delete-campaign/:id', authenticateAdmin, async (req, res) => {
  try {
    const campaign = await Campaign.findById(req.params.id);
    if (!campaign) {
      return res.status(404).json({ error: 'Campaign not found' });
    }

    // Delete all transactions related to this campaign
    await Transaction.deleteMany({ campaignId: campaign._id });

    // Delete the campaign
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

    const cryptoAmount = (amount / 0.7).toFixed(6);
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

    switch (gateway) {
      case 'Transak':
        paymentUrl = `https://global.transak.com/?apiKey=${process.env.TRANSFER_API_KEY}&cryptoCurrency=MATIC&cryptoAmount=${cryptoAmount}&fiatCurrency=USD&fiatAmount=${amount}&network=polygon&walletAddress=${campaign.creatorWallet}&orderId=${orderId}`;
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
    res.status(500).json({ error: 'Server error' });
  }
});

app.post('/api/webhook/payment', async (req, res) => {
  try {
    const { transactionId, status, gatewayTransactionId } = req.body;

    const transaction = await Transaction.findOne({ 
      gatewayTransactionId: transactionId || gatewayTransactionId 
    });

    if (!transaction) {
      return res.status(404).json({ error: 'Transaction not found' });
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

// ========== START SERVER ==========

const PORT = process.env.PORT || 5000;
app.listen(PORT, () => {
  console.log(`🚀 Server running on port ${PORT}`);
  console.log(`🌐 Website: https://fundbridge.space`);
  console.log(`🔐 Admin: https://fundbridge.space/admin.html`);
  console.log(`📋 Privacy: https://fundbridge.space/privacy.html`);
  console.log(`📋 Terms: https://fundbridge.space/terms.html`);
  console.log(`💚 Health: https://fundbridge.space/api/health`);
});