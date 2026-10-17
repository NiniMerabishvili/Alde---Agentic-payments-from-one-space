# Alde: agentic payments from one combined balance

Tell the agent what to pay in plain words ("pay my water bill for this month", "buy two ice skating vouchers from Swoop at Leadersport Arena"). It finds the bill or offer, then pays from **all of your linked cards as one balance**. Cards are drained in your priority order (₾24 = BOG ₾20 + TBC ₾4), so you never move money between banks yourself.

## Run

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # static site in dist/
```

## Deploy (static, any host)

```bash
npx vercel --prod          # or
npx netlify deploy --prod --dir dist   # or
npx surge dist
```

## What you can say

- **Pay / buy:** "buy two ice skating vouchers on Swoop at Leadersport Arena", "pay water bill", "pay gas from TBC", "top up Magti with 10 lari", "send 15 lari to Nika". Several at once: "buy ice skating vouchers, pay water bill, pay gas bill".
- **Control the wallet:** "make TBC my main card", "don't use Solana" / "resume Solana", "add Liberty card with 100 lari", "remove the USDT card".
- **Ask:** "what's my balance", "what did I spend", "show my vouchers".

Voice: tap the heart or the mic. Chrome, Edge and Safari use built-in speech recognition. Brave, Firefox and others use Whisper running inside the browser: the model (~80 MB) downloads on first use, then it's cached.

## How it's built

| File | Role |
|---|---|
| `src/lib/agent.ts` | `interpret()`: text → intent (typo tolerant). `splitTasks()`: one message → several operations. `run()`: executes an operation as a stream of steps plus live browser screens |
| `src/lib/swoop.ts` | **Live** Swoop search through `api.swoop.ge` (public, CORS-open). Falls back to a demo catalog when offline |
| `src/lib/wallet.ts` | Accounts (GEL, USDT, USD/Solana), combined balance, waterfall split with optional per-payment card preference |
| `src/lib/voice.ts`, `whisper.worker.ts` | Voice input: Web Speech API, or on-device Whisper (transformers.js) as the fallback |
| `src/components/LiveScreen.tsx` | The agent's browser: typing the search, results with real photos and prices, choosing, quantity, checkout split, confirmation |
| `src/App.tsx` | Operation queue, operation pills around the heart, memory in `localStorage` (`alde.v2`) |

**What is real vs simulated:** Swoop offers, prices and images are live. Checkout, utility bill amounts, top-ups and transfers are simulated: no money moves and voucher codes are generated. Real payments would replace `pay()` in `agent.ts`; the UI consumes the same event stream either way.

Use **Reset demo** at the bottom of the card stack to restore the starting balances and clear the history.
