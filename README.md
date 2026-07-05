# DampingVar.com – B2B Real-time Wholesale Trading Platform

## Setup

1. **Supabase**:
   - Create new project.
   - Run migrations from `supabase/migrations/`.
   - Set up Storage buckets: `product-images`, `invoices`, `waybills`, `avatars`.
   - Enable Realtime for tables: `auctions`, `auction_bids`, `orders`, `transactions`, `notifications`.

2. **Environment**:
   - Copy `.env.example` to `.env` and fill with your Supabase credentials.

3. **Local Development**:
   - Use any static server (e.g., `npx serve .`).
   - Build not required (vanilla JS).

4. **Deploy to Vercel**:
   - Connect GitHub repo.
   - Add environment variables in Vercel dashboard.
   - Deploy.

## Features
- Real‑time auctions with anti‑sniping (+5 min)
- Trink Sat (instant discount buying)
- Escrow payment system
- Influencer commission (up to +2%)
- Logistics tracking
- PDF invoices (jsPDF)
- Role‑based access (buyer, seller, admin, influencer, logistics, finance)
- Dark neon trading UI with glassmorphism

## Tech Stack
- Frontend: HTML5, TailwindCSS, Vanilla JS (ES Modules)
- Backend: Supabase (Auth, Postgres, Realtime, Storage)
- Hosting: Vercel
- PDF: jsPDF
- Charts: Chart.js