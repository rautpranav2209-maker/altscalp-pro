# AltScalp PRO 🚀

**Institutional AI Crypto Scalping Dashboard** — Real-time signals, order flow analysis, ML-powered trading tools.

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/rautpranav2209-maker/altscalp-pro)

---

## 🌟 Features

- **AI Signals** — ML-powered BUY/SELL/HOLD signals with confidence scores
- **Real-time Scanner** — Live price updates across 50+ trading pairs
- **Order Flow** — Order book depth, volume delta, funding rates
- **Paper Trading** — Simulate trades with virtual portfolio
- **Risk Management** — Position sizing, stop-loss, take-profit automation
- **Multi-Exchange** — Binance, Bybit, OKX, Gate.io data aggregation
- **TradingView Charts** — Integrated charting with EMA, Bollinger Bands, RSI, MACD
- **PWA Support** — Installable as a Progressive Web App

---

## 📁 Project Structure

```
altscalp-pro/
├── index.html          # Main application shell (HTML only)
├── styles.css          # All application styles
├── app.js              # Application logic and UI interactions
├── service-worker.js   # PWA caching and offline support
├── manifest.json       # PWA manifest
├── logo.png            # App icon
├── 404.html            # Custom 404 page
├── vercel.json         # Vercel deployment config
├── package.json        # Project metadata and scripts
├── chart.umd.js        # Chart.js library (bundled)
├── firebase-app.js     # Firebase core (bundled)
├── firebase-auth.js    # Firebase Auth (bundled)
├── firebase-firestore.js # Firebase Firestore (bundled)
├── firebase-analytics.js # Firebase Analytics (bundled)
├── razorpay.js         # Razorpay payment SDK (bundled)
├── tv.js               # TradingView lightweight charts (bundled)
├── tv-widget.js        # TradingView widget helper (bundled)
└── api/                # Vercel serverless functions
    ├── create-order.js     # Razorpay order creation
    ├── verify-payment.js   # Payment verification
    └── webhooks/
        └── razorpay.js     # Razorpay webhook handler
```

---

## 🚀 Deploy

### One-Click Vercel Deploy

[![Deploy with Vercel](https://vercel.com/button)](https://vercel.com/new/clone?repository-url=https://github.com/rautpranav2209-maker/altscalp-pro)

### Manual Vercel Deploy

```bash
npm i -g vercel
vercel --prod
```

### GitHub Pages

1. Fork this repo
2. Go to **Settings → Pages**
3. Set source to `main` branch, `/ (root)` folder
4. Your site will be live at `https://yourusername.github.io/altscalp-pro`

### Local Development

```bash
npm install
npm run dev
# Open http://localhost:3000
```

---

## ⚙️ Environment Variables

Set these in your Vercel dashboard or `.env` file:

| Variable | Description |
|----------|-------------|
| `RAZORPAY_KEY_ID` | Razorpay API Key ID |
| `RAZORPAY_KEY_SECRET` | Razorpay API Key Secret |
| `FIREBASE_SERVICE_ACCOUNT` | Firebase Admin SDK service account (base64 encoded) |
| `WEBHOOK_SECRET` | Razorpay webhook secret |

---

## 🛠️ Tech Stack

- **Frontend**: Vanilla JS, HTML5, CSS3
- **Charts**: Chart.js, TradingView Lightweight Charts
- **Auth/DB**: Firebase Authentication + Firestore
- **Payments**: Razorpay
- **Deployment**: Vercel (serverless)
- **PWA**: Service Worker + Web App Manifest

---

## 📄 License

MIT © 2026 AltScalp PRO
