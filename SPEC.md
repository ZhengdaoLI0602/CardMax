# CardMax v0.1.2 Specification

## Goal

CardMax converts a manually exported monthly iCost XLSX into a concise credit-card reward progress and recommendation report for Mainland China, Hong Kong, and Overseas spending.

## Input workflow

1. Use iCost normally.
2. Export the current-month XLSX.
3. Save it in `On My iPhone/CardMax`.
4. Open CardMax and tap **同步 iCost**.
5. Select the newest XLSX from Files.
6. CardMax parses the workbook locally and recalculates the month from scratch.

PWA limitation: CardMax does not silently scan `On My iPhone/CardMax` in the background. File selection is a user-authorised action.

## Transaction filter

Only transactions satisfying all conditions are analysed:

- `Ledger` is in the configured ledger whitelist: `manhu budget`, `dogi budget`
- `Type = Expense`
- `Amount < 0`
- `Account 1` exists in `config/cards.json` and is enabled

All qualifying credit-card transactions from the enabled ledgers are pooled into the same monthly reward calculation. Examples intentionally excluded: Alipay, WechatPay, BOC debit cards and all other non-whitelisted accounts.

## Region classification

- `CNY -> CN`
- `HKD -> HK`
- all other currencies -> `OVERSEAS`

No address-based correction is performed in v0.1.2.

## Account mapping

- `AEON 7418` -> AEON Purple UnionPay
- `HSBC 6287` -> HSBC Red
- `HSBC 3789` -> HSBC Pulse
- `Mox 4362` -> Mox Credit
- `BOCHK 0111` -> BOCHK Go
- `BOCHK 0035` -> BOCHK Chill World
- MMPOWER is planned but disabled until its iCost account name is known.

## User-specific payment assumptions

- BOCHK Go + CN -> default Apple Pay / eligible UnionPay QR
- BOCHK Go + HK -> default Apple Pay
- HSBC Pulse + CN -> default Apple Pay
- AEON Purple qualifying HK dining/transport -> default mobile payment for optimisation estimates

These assumptions are intentional to keep CardMax simple and avoid additional manual tags.

## Merchant normalisation

Raw iCost merchant descriptions are first mapped to canonical merchant IDs using `config/merchant_aliases.json`. Reward matching operates on canonical IDs while the original description is retained for audit display.

## Core reward behaviours

### BOCHK Go

- CN designated Go merchants such as confirmed `MEITUAN`: around 5% reward under the designated-merchant pool.
- Other qualifying CN Apple Pay / UnionPay QR transactions: around 8% total reward.
- HK Apple Pay: around 4% total reward.
- CN and HK mobile-payment extra points share the relevant monthly bonus pool.

### HSBC Pulse

- CN Apple Pay default: 0.4% base + 2% = 2.4%.
- CardMax shows a dedicated Pulse monthly-spend and estimated-reward card.
- Registered Mainland spending offer: monthly qualifying HSBC Mainland spending target HK$1,200, calculated across qualifying HSBC cards.
- Once the monthly target is met, qualifying Pulse Mainland dining receives an additional 3%, subject to the HK$80 monthly bonus cap.

### AEON Purple UnionPay

#### Hong Kong

- Eligible local dining paid by mobile payment: up to 6% total points-equivalent reward.
- Eligible local transport paid by mobile payment: up to 6% total points-equivalent reward.
- Dining and transport are tracked as separate reward pools.
- Each category has an extra-reward cap equivalent to approximately HK$100 per month.
- With 0.4% base reward and 5.6% extra reward, the remaining high-reward spend is derived from the unused extra-reward cap.
- Other HK spending falls back to the base reward estimate.

#### Mainland / Macau / Taiwan

- Registered Aug-Oct 2026 UnionPay promotion: up to 6% total points-equivalent reward.
- Monthly extra-reward cap: approximately HK$100.
- User model deducts the approximately 1% foreign-currency fee, so the high-reward band is displayed as about 5% net.

#### Other foreign currency / overseas

- Registered Aug-Oct 2026 UnionPay promotion: up to 6% total points-equivalent reward.
- Monthly extra-reward cap: approximately HK$200.
- User model deducts the approximately 1% foreign-currency fee, so the high-reward band is displayed as about 5% net.
- Exact HKD progress cannot yet be calculated for currencies other than CNY/HKD because v0.1.2 does not invent an FX rate.

### HSBC Red

- Online spend: 4% on the first HK$10,000 per month, then 0.4% base.
- Non-HKD transactions may incur approximately 1.95% foreign-currency fee; HKD-settled transactions do not.
- HSBC Octopus top-up: 0.4%, not Red online 4%.
- Japan designated merchants are maintained as a separate higher-reward rule.

### BOCHK Chill World

- Online / eligible overseas spend: 5% headline reward (0.4% base + 4.6% extra), subject to the shared extra cash-rebate cap.
- Non-HKD foreign-currency spend deducts the applicable foreign-currency fee when estimating net return.

### Mox Credit

- Current role: overseas 0 FX + Asia Miles fallback after higher-return reward pools are exhausted.

### MMPOWER

- Planned for rule support but disabled until an actual iCost account mapping exists.

## Data privacy

- XLSX parsing occurs locally in the browser.
- Real iCost files are not uploaded to GitHub by CardMax.
- GitHub contains source code, reward rules, merchant aliases and anonymised tests only.

## Rule maintenance

Bank promotion parameters live in `config/rules.json` and should be reviewed monthly. Application code should not be rewritten merely because a bank changes a percentage, cap, promotion date or merchant list.

## v0.1.2 known limitation

CardMax does not invent FX rates. Exact HKD reward estimates are produced where an HKD-equivalent amount is safe under the configured rule. Overseas currencies can still be classified and recommended even when an exact HKD reward amount is unavailable.
