const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const rateLimit = require('express-rate-limit');

const db = require('./services/db');
const { router: authRoutes } = require('./routes/authRoutes');
const mediaRoutes = require('./routes/mediaRoutes');
const walletRoutes = require('./routes/walletRoutes');
const referralRoutes = require('./routes/referralRoutes');
const adminRoutes = require('./routes/adminRoutes');

const app = express();
const PORT = process.env.PORT || 3000;

// Security Headers with Content-Security-Policy tuned for Google Identity & AdSense
app.use(
  helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://accounts.google.com",
          "https://pagead2.googlesyndication.com"
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://fonts.googleapis.com"
        ],
        fontSrc: ["'self'", "https://fonts.gstatic.com"],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://images.unsplash.com",
          "https://api.dicebear.com",
          "https://*.googleusercontent.com",
          "https://pagead2.googlesyndication.com"
        ],
        connectSrc: ["'self'", "https://accounts.google.com"],
        frameSrc: [
          "'self'",
          "https://accounts.google.com",
          "https://googleads.g.doubleclick.net"
        ]
      }
    },
    crossOriginEmbedderPolicy: false
  })
);

app.use(cors());
app.use(cookieParser());
app.use(express.json({ limit: '5mb' }));
app.use(express.urlencoded({ extended: true }));

// Anti-Bot & Anti-Spam Rate Limiter (Max 120 requests per IP per minute)
const generalLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 120,
  standardHeaders: true,
  legacyHeaders: false,
  message: {
    success: false,
    error: 'Too many requests from this IP. Anti-bot protection activated. Please slow down.'
  }
});
app.use('/api/', generalLimiter);

// Specific stricter limiter for media extraction and download requests (Max 35 requests per min)
const mediaLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 35,
  message: {
    success: false,
    error: 'Media extraction rate limit exceeded. Please wait a minute.'
  }
});
app.use('/api/media/', mediaLimiter);

// Static Asset Serving
app.use(express.static(path.join(__dirname, 'public')));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/media', mediaRoutes);
app.use('/api/wallet', walletRoutes);
app.use('/api/referrals', referralRoutes);
app.use('/api/admin', adminRoutes);

// Health check and system time info
app.get('/api/health', (req, res) => {
  res.json({
    status: 'healthy',
    timestamp: new Date().toISOString(),
    istCycle: db.getCurrentIstCycleKey(),
    nextIstReset: db.getNextIstResetTime()
  });
});

// SPA Fallback to index.html
app.get('*', (req, res) => {
  res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

// Periodic IST 4:00 AM Reset Heartbeat
setInterval(() => {
  // DB automatically calculates dynamic cycle key per request, but this ensures periodic log
  const now = new Date();
  const istOffsetMs = 5.5 * 60 * 60 * 1000;
  const istTime = new Date(now.getTime() + istOffsetMs);
  if (istTime.getUTCHours() === 4 && istTime.getUTCMinutes() === 0) {
    console.log(`[LEDGER RESET] 4:00 AM IST global daily reset cycle activated: ${db.getCurrentIstCycleKey()}`);
  }
}, 60 * 1000);

// Server startup
app.listen(PORT, () => {
  console.log(`=======================================================`);
  console.log(` PulseGrab Ecosystem 2.0 Server Active on Port ${PORT}`);
  console.log(` Local URL: http://localhost:${PORT}`);
  console.log(` IST Cycle: ${db.getCurrentIstCycleKey()} | Next 4AM Reset: ${db.getNextIstResetTime()}`);
  console.log(`=======================================================`);
});
