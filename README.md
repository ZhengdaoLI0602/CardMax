# CardMax

CardMax is a personal PWA for analysing monthly iCost credit-card transactions and estimating remaining high-reward spend by card and region.

## v0.1 scope

- Input: iCost `.xlsx` export selected manually from Files (intended folder: `On My iPhone/CardMax`).
- Analyse only rows where:
  - `Ledger = manhu budget`
  - `Type = Expense`
  - `Amount < 0`
  - `Account 1` is in the CardMax credit-card whitelist.
- Region classification:
  - `CNY -> CN`
  - `HKD -> HK`
  - every other currency -> `OVERSEAS`
- Merchant names are normalised before reward matching.
- Reward rules are stored separately from application logic so they can be updated without rewriting the reward engine.
- Real transaction files are never committed to this repository.

## Supported cards

- HSBC Red
- HSBC Pulse
- BOCHK Chill World
- BOCHK Go
- AEON Purple UnionPay
- Mox Credit
- Hang Seng MMPOWER (planned; account mapping to be added once available)

## Privacy

CardMax parses the selected workbook in the browser. Real iCost workbooks and transaction data must not be committed to GitHub.

## Development status

`v0.1` implementation has started directly on `main` as requested by the repository owner.
