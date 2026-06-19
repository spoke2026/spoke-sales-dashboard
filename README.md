# Spoke Sales Dashboard

Live sales performance dashboard pulling real-time data from HubSpot. Built with Next.js, deployed on Vercel at `dashboard.spoke.nz`.

## Features

- Live HubSpot data — refreshes every 15 minutes
- Secure backend: API key never exposed to the browser
- Month and rep filters
- Interactive Chart.js graphs with hover tooltips
- Deal age drill-down by age band
- Admin PIN to protect target editing

---

## Local Development

### 1. Clone and install

```bash
git clone https://github.com/YOUR_USERNAME/spoke-sales-dashboard.git
cd spoke-sales-dashboard
npm install
```

### 2. Set up environment variables

```bash
cp .env.local.example .env.local
```

Edit `.env.local` and fill in your values:

```
HUBSPOT_API_KEY=pat-ap1-your-service-key-here
NEXT_PUBLIC_ADMIN_PIN=1234
HUBSPOT_BESPOKE_PIPELINE_ID=1663955429
HUBSPOT_REVENUE_TRAIN_PIPELINE_ID=1691758052
HUBSPOT_GOODS_SHIPPED_STAGE_ID=2795435483
HUBSPOT_INVOICED_STAGE_ID=2795858407
```

### 3. Run locally

```bash
npm run dev
```

Open http://localhost:3000

---

## Deploy to Vercel

### 1. Push to GitHub

```bash
git init
git add .
git commit -m "Initial commit: Spoke Sales Dashboard"
git branch -M main
git remote add origin https://github.com/YOUR_USERNAME/spoke-sales-dashboard.git
git push -u origin main
```

### 2. Connect to Vercel

1. Go to vercel.com and sign in with GitHub
2. Click **New Project**
3. Select `spoke-sales-dashboard`
4. Framework: **Next.js** (auto-detected)
5. Add environment variables (see below)
6. Click **Deploy**

### 3. Add environment variables in Vercel

In your Vercel project: **Settings > Environment Variables**

| Name | Value |
|------|-------|
| `HUBSPOT_API_KEY` | `pat-ap1-your-key-here` |
| `NEXT_PUBLIC_ADMIN_PIN` | `1234` |
| `HUBSPOT_BESPOKE_PIPELINE_ID` | `1663955429` |
| `HUBSPOT_REVENUE_TRAIN_PIPELINE_ID` | `1691758052` |
| `HUBSPOT_GOODS_SHIPPED_STAGE_ID` | `2795435483` |
| `HUBSPOT_INVOICED_STAGE_ID` | `2795858407` |

### 4. Point dashboard.spoke.nz to Vercel

In your DNS provider (where you manage spoke.nz):

```
Type: CNAME
Name: dashboard
Value: cname.vercel-dns.com
```

In Vercel: **Settings > Domains > Add** `dashboard.spoke.nz`

SSL certificate generates automatically within a few minutes.

---

## Project Structure

```
spoke-sales-dashboard/
├── app/
│   ├── api/
│   │   └── dashboard/
│   │       └── route.js        ← Secure HubSpot API endpoint
│   ├── layout.js               ← Fonts + metadata
│   ├── page.js                 ← Main dashboard component
│   ├── dashboard.module.css    ← All styles
│   └── globals.css             ← Brand tokens
├── lib/
│   └── hubspot.js              ← All HubSpot data fetching
├── public/
│   └── spoke-logo.png          ← Spoke logo
├── .env.local.example          ← Environment variable template
├── .gitignore
├── next.config.js
├── package.json
└── README.md
```

---

## Data Sources

| Metric | Source | Filter |
|--------|--------|--------|
| Total Sales | Bespoke Operations pipeline deals | Close date = this month |
| Connected Calls | HubSpot Call objects | Status = CONNECTED, this month |
| Face-to-Face Visits | HubSpot Meeting objects | Start date = this month |
| New Pipeline Value | Revenue Train pipeline deals | Created this month, excl. won |
| Average Deal Age | Bespoke Operations deals | Working days from creation, at Goods Shipped or Invoiced |

---

## Adding Monthly Budgets

Currently budgets are hardcoded in `app/api/dashboard/route.js`:

```js
const BUDGETS = {
  sales: 150000,
  calls: 60,
  visits: 20,
  pipeline: 200000,
}
```

To make these editable by admins without a code deploy, connect Supabase:
1. Create a `budgets` table in Supabase
2. Add `SUPABASE_URL` and `SUPABASE_ANON_KEY` to env vars
3. Update `route.js` to fetch from Supabase instead

---

## Refresh Schedule

- Automatic: every 15 minutes
- On filter change: immediately on month or rep change
- Manual: refresh the browser tab

---

## Troubleshooting

**Charts not showing:** Check browser console for API errors. Verify `HUBSPOT_API_KEY` is set in Vercel env vars.

**No data / zeros everywhere:** Check that the pipeline IDs match your HubSpot account. Confirm in HubSpot: Settings > Sales > Pipelines and note the pipeline IDs.

**CORS errors:** These shouldn't occur on Vercel since all HubSpot calls are server-side. If you see them, ensure you are calling `/api/dashboard` not HubSpot directly.

**DNS not resolving:** Allow 24-48 hours for DNS propagation. Use `dig dashboard.spoke.nz` to check.
