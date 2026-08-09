# CardMax v0.1 Specification

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

- `Ledger = manhu budget`
- `Type = Expense`
- `Amount < 0`
- `Account 1` exists in `config/cards.json` and is enabled

Examples intentionally excluded: Alipay, WechatPay, BOC debit cards and all other non-whitelisted accounts.

## Region classification

- `CNY -> CN`
- `HKD -> HK`
- all other currencies -> `OVERSEAS`

No address-based correction is performed in v0.1.

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

These assumptions are intentional to keep CardMax simple and avoid additional manual tags.

## Merchant normalisation

Raw iCost merchant descriptions are first mapped to canonical merchant IDs using `config/merchant_aliases.json`. Reward matching operates on canonical IDs while the original description is retained for audit display.

Examples:

- Meituan variants -> `MEITUAN`
- JD variants -> `JD`
- Pinduoduo variants -> `PINDUODUO`
- McDonald's variants -> `MCDONALDS`
- `Zgylgfyxgs Shanxi Chn` -> `HEMA`
- `Asia Pacific 32000 Hongkong Hkg`, `文康`, `The Forest` -> `CANTEEN`

## Core reward behaviours

### BOCHK Go

- CN designated Go merchants such as confirmed `MEITUAN`: around 5% reward under the designated-merchant pool.
- Other qualifying CN Apple Pay / UnionPay QR transactions: around 8% total reward.
- HK Apple Pay: around 4% total reward.
- CN and HK mobile-payment extra points share the relevant monthly bonus pool.

### HSBC Pulse

- CN Apple Pay default: 0.4% base + 2% = 2.4%.
- Registered Mainland spending offer: monthly qualifying HSBC Mainland spending target HK$1,200.
- Once the monthly target is met, qualifying Pulse Mainland dining receives an additional 3%, subject to its reward cap.

### AEON Purple UnionPay

- HK selected local dining/transport categories: around 6% points-equivalent reward when eligible.
- CN/Overseas registered promotion: around 6% gross, less approximately 1% foreign-currency fee -> around 5% net.

### HSBC Red

- Online spend: 4% on the first HK$10,000 per month, then 0.4% base.
- Non-HKD transactions may incur approximately 1.95% foreign-currency fee; HKD-settled transactions do not.
- HSBC Octopus top-up: 0.4%, not Red online 4%.
- Japan designated merchants (e.g. SUICA / FamilyMart) are maintained as a separate higher-reward rule.

### BOCHK Chill World

- Online / eligible overseas spend: 5% headline reward (0.4% base + 4.6% extra), subject to the shared extra cash-rebate cap.
- Non-HKD foreign-currency spend deducts the applicable foreign-currency fee when estimating net return.

### Mox Credit

- Current role: overseas 0 FX + Asia Miles fallback after higher-return reward pools are exhausted.

### MMPOWER

- Planned for v0.1 rule support but disabled until an actual iCost account mapping exists.

## Data privacy

- XLSX parsing occurs locally in the browser.
- Real iCost files are not uploaded to GitHub by CardMax.
- GitHub contains source code, reward rules, merchant aliases and anonymised tests only.

## Rule maintenance

Bank promotion parameters live in `config/rules.json` and should be reviewed monthly. Application code should not be rewritten merely because a bank changes a percentage, cap, promotion date or merchant list.

## v0.1 known limitation

CardMax does not invent FX rates. Exact HKD reward estimates are produced where an HKD-equivalent amount is safe under the configured rule. Overseas currencies can still be classified and recommended even when an exact HKD reward amount is unavailable.
