const $ = (selector) => document.querySelector(selector);

const state = {
  cards: {},
  aliases: {},
  rules: null,
  transactions: [],
  region: 'CN',
  monthKey: null,
  sourceFile: null,
  sourceDateMin: null,
  sourceDateMax: null
};

const ONLINE_MERCHANTS = new Set(['AGODA', 'CHINA_EASTERN', 'EXPEDIA', 'JD', 'PINDUODUO']);
const DINING_WORDS = ['restaurant', 'dining', 'food', '餐饮', '正餐', '美食', '快餐', '烧烤', '火锅'];

async function loadConfig() {
  const [cards, aliases, rules] = await Promise.all([
    fetch('./config/cards.json', { cache: 'no-store' }).then(r => r.json()),
    fetch('./config/merchant_aliases.json', { cache: 'no-store' }).then(r => r.json()),
    fetch('./config/rules.json', { cache: 'no-store' }).then(r => r.json())
  ]);
  state.cards = cards;
  state.aliases = aliases;
  state.rules = rules;
  $('#rulesVersion').textContent = rules.version;
}

function normalizeText(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

function configuredLedgers() {
  const profile = state.rules?.profile || {};
  const raw = Array.isArray(profile.ledgers) && profile.ledgers.length
    ? profile.ledgers
    : [profile.ledger].filter(Boolean);
  return raw.map(x => normalizeText(x));
}

function normalizeMerchant(original) {
  const raw = normalizeText(original);
  if (!raw) return 'UNKNOWN';
  const lower = raw.toLowerCase();
  for (const [canonical, variants] of Object.entries(state.aliases)) {
    for (const variant of variants) {
      const needle = normalizeText(variant).toLowerCase();
      if (needle && (lower === needle || lower.includes(needle))) return canonical;
    }
  }
  return raw;
}

function classifyRegion(currency) {
  const code = normalizeText(currency).toUpperCase();
  if (code === 'CNY') return 'CN';
  if (code === 'HKD') return 'HK';
  return 'OVERSEAS';
}

function parseDate(value) {
  if (value instanceof Date && !Number.isNaN(value.valueOf())) return value;
  if (typeof value === 'number' && window.XLSX?.SSF) {
    const p = XLSX.SSF.parse_date_code(value);
    if (p) return new Date(p.y, p.m - 1, p.d, p.H || 0, p.M || 0, Math.floor(p.S || 0));
  }
  const text = normalizeText(value).replace(/\./g, '/');
  const d = new Date(text);
  return Number.isNaN(d.valueOf()) ? null : d;
}

function monthKey(date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

function formatDate(date) {
  return new Intl.DateTimeFormat('zh-HK', { month: '2-digit', day: '2-digit' }).format(date);
}

function formatFullDate(date) {
  return new Intl.DateTimeFormat('zh-HK', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function pick(row, names) {
  for (const name of names) {
    if (Object.prototype.hasOwnProperty.call(row, name)) return row[name];
    const key = Object.keys(row).find(k => normalizeText(k).toLowerCase() === name.toLowerCase());
    if (key) return row[key];
  }
  return undefined;
}

function isDining(tx) {
  const text = `${tx.firstCategory} ${tx.secondCategory} ${tx.originalMerchant}`.toLowerCase();
  return DINING_WORDS.some(word => text.includes(word));
}

function isOnline(tx) {
  if (ONLINE_MERCHANTS.has(tx.merchant)) return true;
  const text = `${tx.firstCategory} ${tx.secondCategory} ${tx.originalMerchant}`.toLowerCase();
  return ['online', '网购', '网上', '互联网'].some(word => text.includes(word));
}

function hkdEquivalent(tx) {
  if (tx.currency === 'HKD' || tx.currency === 'CNY') return tx.amount;
  return null;
}

function parseRows(rows) {
  const ledgersWanted = new Set(configuredLedgers().map(x => x.toLowerCase()));
  const parsedAll = rows.map((row, index) => {
    const date = parseDate(pick(row, ['Date', '日期']));
    const amountRaw = Number(pick(row, ['Amount', '金额']));
    const account = normalizeText(pick(row, ['Account 1', '账户1', 'Account']));
    const type = normalizeText(pick(row, ['Type', '类型']));
    const ledger = normalizeText(pick(row, ['Ledger', '账本']));
    const currency = normalizeText(pick(row, ['Currency', '币种'])).toUpperCase();
    const originalMerchant = normalizeText(pick(row, ['Remark', '备注', 'Merchant', '商户']));
    return {
      sourceIndex: index + 2,
      date,
      amount: Math.abs(amountRaw),
      signedAmount: amountRaw,
      account,
      card: state.cards[account],
      type,
      ledger,
      currency,
      region: classifyRegion(currency),
      originalMerchant,
      merchant: normalizeMerchant(originalMerchant),
      firstCategory: normalizeText(pick(row, ['First-Level Category', '一级分类'])),
      secondCategory: normalizeText(pick(row, ['Second-Level Category', '二级分类']))
    };
  });

  const dated = parsedAll.filter(tx => tx.date);
  if (dated.length) {
    state.sourceDateMin = dated.reduce((a, b) => a.date < b.date ? a : b).date;
    state.sourceDateMax = dated.reduce((a, b) => a.date > b.date ? a : b).date;
  }

  const parsed = parsedAll.filter(tx =>
    tx.date &&
    tx.card?.enabled &&
    tx.type.toLowerCase() === 'expense' &&
    tx.signedAmount < 0 &&
    ledgersWanted.has(tx.ledger.toLowerCase())
  );

  if (!parsed.length) return [];
  const latest = parsed.reduce((a, b) => a.date > b.date ? a : b).date;
  state.monthKey = monthKey(latest);
  return parsed
    .filter(tx => monthKey(tx.date) === state.monthKey)
    .sort((a, b) => a.date - b.date || a.sourceIndex - b.sourceIndex);
}

function applyTieredReward(amount, rate, baseRate, spendUsed, spendCap) {
  const highRemaining = Math.max(0, spendCap - spendUsed);
  const highPart = Math.min(amount, highRemaining);
  const basePart = amount - highPart;
  return {
    reward: highPart * rate + basePart * baseRate,
    nextSpendUsed: spendUsed + amount
  };
}

function evaluate(transactions) {
  const r = state.rules.cards;
  const pools = {
    goDesignatedReward: 0,
    goMobileBonusReward: 0,
    redOnlineSpend: 0,
    chillExtraReward: 0,
    pulseDiningBonusReward: 0
  };

  const hsbcCNSpend = transactions
    .filter(tx => ['hsbc_red', 'hsbc_pulse'].includes(tx.card.id) && tx.region === 'CN')
    .reduce((sum, tx) => sum + (hkdEquivalent(tx) ?? 0), 0);
  const pulseThresholdMet = hsbcCNSpend >= r.hsbc_pulse.CN.mainlandMonthlyThreshold.amountHKD;

  const evaluated = transactions.map(tx => {
    const amountHKD = hkdEquivalent(tx);
    let label = '未配置高回赠规则';
    let grossRate = null;
    let netRate = null;
    let rewardHKD = null;

    if (tx.card.id === 'bochk_go') {
      if (tx.region === 'CN' && r.bochk_go.CN.designatedMerchants.merchants.includes(tx.merchant)) {
        const rule = r.bochk_go.CN.designatedMerchants;
        grossRate = netRate = rule.grossRate;
        label = rule.label;
        if (amountHKD != null) {
          const remaining = Math.max(0, rule.monthlyRewardCapHKD - pools.goDesignatedReward);
          rewardHKD = Math.min(amountHKD * grossRate, remaining);
          pools.goDesignatedReward += rewardHKD;
        }
      } else if (['CN', 'HK'].includes(tx.region)) {
        const rule = tx.region === 'CN' ? r.bochk_go.CN.mobile : r.bochk_go.HK.mobile;
        grossRate = netRate = rule.grossRate;
        label = rule.label;
        if (amountHKD != null) {
          const bonusRate = grossRate - rule.baseRate;
          const remainingBonus = Math.max(0, r.bochk_go.CN.mobile.bonusEquivalentCapHKD - pools.goMobileBonusReward);
          const bonus = Math.min(amountHKD * bonusRate, remainingBonus);
          rewardHKD = amountHKD * rule.baseRate + bonus;
          pools.goMobileBonusReward += bonus;
        }
      }
    }

    if (tx.card.id === 'hsbc_red') {
      if (tx.merchant === 'OCTOPUS') {
        const rule = r.hsbc_red.octopus;
        grossRate = netRate = rule.grossRate;
        label = rule.label;
        if (amountHKD != null) rewardHKD = amountHKD * grossRate;
      } else if (isOnline(tx)) {
        const rule = r.hsbc_red.online;
        label = rule.label;
        if (amountHKD != null) {
          const tier = applyTieredReward(amountHKD, rule.grossRate, rule.baseRate, pools.redOnlineSpend, rule.monthlySpendCapHKD);
          rewardHKD = tier.reward;
          grossRate = rewardHKD / amountHKD;
          pools.redOnlineSpend = tier.nextSpendUsed;
          netRate = grossRate - (tx.currency === 'HKD' ? 0 : rule.foreignFeeRate);
        } else {
          grossRate = rule.grossRate;
          netRate = grossRate - rule.foreignFeeRate;
        }
      } else {
        grossRate = netRate = 0.004;
        label = 'HSBC 基础回赠 0.4%';
        if (amountHKD != null) rewardHKD = amountHKD * grossRate;
      }
    }

    if (tx.card.id === 'hsbc_pulse' && tx.region === 'CN') {
      const rule = r.hsbc_pulse.CN.applePay;
      grossRate = netRate = rule.grossRate;
      label = rule.label;
      if (isDining(tx) && pulseThresholdMet) {
        const bonusRule = r.hsbc_pulse.CN.diningBonus;
        const remaining = Math.max(0, bonusRule.monthlyRewardCapHKD - pools.pulseDiningBonusReward);
        const bonus = amountHKD == null ? null : Math.min(amountHKD * bonusRule.extraRate, remaining);
        if (bonus != null) pools.pulseDiningBonusReward += bonus;
        grossRate += bonusRule.extraRate;
        netRate = grossRate;
        label += ' + 餐饮额外 3%';
        if (amountHKD != null) rewardHKD = amountHKD * rule.grossRate + bonus;
      } else if (amountHKD != null) {
        rewardHKD = amountHKD * grossRate;
      }
    }

    if (tx.card.id === 'aeon_purple') {
      let rule = null;
      if (tx.region === 'CN') rule = r.aeon_purple.CN.general;
      if (tx.region === 'OVERSEAS') rule = r.aeon_purple.OVERSEAS.general;
      if (tx.region === 'HK' && (isDining(tx) || tx.merchant === 'MTR')) rule = r.aeon_purple.HK.localSelected;
      if (rule) {
        grossRate = rule.grossRate;
        netRate = rule.netRate;
        label = rule.label;
        if (amountHKD != null) rewardHKD = amountHKD * netRate;
      }
    }

    if (tx.card.id === 'bochk_chill') {
      const rule = isOnline(tx) ? r.bochk_chill.online : (tx.region === 'OVERSEAS' ? r.bochk_chill.overseas : null);
      if (rule) {
        grossRate = rule.grossRate;
        label = rule.label;
        netRate = grossRate - (tx.currency === 'HKD' ? 0 : rule.foreignFeeRate);
        if (amountHKD != null) {
          const remainingExtra = Math.max(0, rule.monthlyExtraRewardCapHKD - pools.chillExtraReward);
          const extra = Math.min(amountHKD * rule.extraRate, remainingExtra);
          pools.chillExtraReward += extra;
          rewardHKD = amountHKD * rule.baseRate + extra - (tx.currency === 'HKD' ? 0 : amountHKD * rule.foreignFeeRate);
          netRate = rewardHKD / amountHKD;
        }
      }
    }

    if (tx.card.id === 'mox_credit' && tx.region === 'OVERSEAS') {
      const rule = r.mox_credit.OVERSEAS;
      label = rule.label;
      netRate = null;
    }

    return { ...tx, amountHKD, label, grossRate, netRate, rewardHKD, online: isOnline(tx), dining: isDining(tx) };
  });

  return { evaluated, pools, hsbcCNSpend, pulseThresholdMet };
}

function money(value) {
  if (value == null || Number.isNaN(value)) return '—';
  return `HK$${value.toLocaleString('en-HK', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function pct(value) {
  if (value == null) return '—';
  return `${(value * 100).toFixed(value * 100 < 10 ? 2 : 1).replace(/\.00$/, '')}%`;
}

function progressCard({ title, rate, used, cap, remainingSpend, advice, warning = false }) {
  const ratio = cap ? Math.min(1, used / cap) : 0;
  return `<article class="reward-card">
    <header><div><div class="reward-title">${title}</div><div class="reward-meta">${cap ? `${money(used)} / ${money(cap)}` : advice}</div></div><div class="reward-rate">${rate}</div></header>
    ${cap ? `<div class="progress"><span style="width:${ratio * 100}%"></span></div>` : ''}
    ${remainingSpend != null ? `<div class="reward-meta">高回赠还可刷约 <strong>${money(Math.max(0, remainingSpend))}</strong></div>` : ''}
    ${advice ? `<div class="reward-advice ${warning ? 'warning' : ''}">${advice}</div>` : ''}
  </article>`;
}

function renderSummary(result) {
  const panel = $('#summaryPanel');
  const r = state.rules.cards;
  const p = result.pools;
  const cards = [];

  if (state.region === 'CN') {
    const goDesignated = r.bochk_go.CN.designatedMerchants;
    cards.push(progressCard({
      title: 'BOCHK Go · 指定商户', rate: '5%', used: p.goDesignatedReward, cap: goDesignated.monthlyRewardCapHKD,
      remainingSpend: (goDesignated.monthlyRewardCapHKD - p.goDesignatedReward) / goDesignated.grossRate,
      advice: 'MEITUAN 等确认的指定商户优先匹配此奖励池。'
    }));
    const goMobile = r.bochk_go.CN.mobile;
    cards.push(progressCard({
      title: 'BOCHK Go · AP / 云闪付', rate: '≈8%', used: p.goMobileBonusReward, cap: goMobile.bonusEquivalentCapHKD,
      remainingSpend: (goMobile.bonusEquivalentCapHKD - p.goMobileBonusReward) / (goMobile.grossRate - goMobile.baseRate),
      advice: 'CN 与 HK 手机支付共用额外积分池。'
    }));
    const target = r.hsbc_pulse.CN.mainlandMonthlyThreshold.amountHKD;
    const remaining = Math.max(0, target - result.hsbcCNSpend);
    cards.push(progressCard({
      title: 'HSBC · 内地月消费门槛', rate: result.pulseThresholdMet ? '已达标' : 'HK$1,200',
      used: result.hsbcCNSpend, cap: target,
      advice: result.pulseThresholdMet ? '已达到本月门槛；合资格 Pulse 内地餐饮可享额外 3%。' : `本月还需约 ${money(remaining)} 合资格 HSBC 内地消费。`,
      warning: !result.pulseThresholdMet
    }));
    const dining = r.hsbc_pulse.CN.diningBonus;
    cards.push(progressCard({
      title: 'HSBC Pulse · 内地餐饮 Bonus', rate: '最高 5.4%', used: p.pulseDiningBonusReward, cap: dining.monthlyRewardCapHKD,
      remainingSpend: (dining.monthlyRewardCapHKD - p.pulseDiningBonusReward) / dining.extraRate,
      advice: '默认 Pulse 内地付款渠道为 Apple Pay。'
    }));
    cards.push(progressCard({ title: 'AEON Purple · 内地', rate: '≈5% net', advice: '当前规则：6% 积分等值 − 1% 外币手续费。' }));
  }

  if (state.region === 'HK') {
    const go = r.bochk_go.HK.mobile;
    const sharedCap = r.bochk_go.CN.mobile.bonusEquivalentCapHKD;
    cards.push(progressCard({
      title: 'BOCHK Go · 香港 AP', rate: '≈4%', used: p.goMobileBonusReward, cap: sharedCap,
      remainingSpend: (sharedCap - p.goMobileBonusReward) / (go.grossRate - go.baseRate),
      advice: '与内地 Go 手机支付共用额外积分池。'
    }));
    cards.push(progressCard({ title: 'AEON Purple · 本地餐饮/交通', rate: '≈6%', advice: '仅在符合当前本地指定类别规则时使用。' }));
    const red = r.hsbc_red.online;
    cards.push(progressCard({
      title: 'HSBC Red · 网购', rate: '4%', used: Math.min(p.redOnlineSpend, red.monthlySpendCapHKD), cap: red.monthlySpendCapHKD,
      remainingSpend: Math.max(0, red.monthlySpendCapHKD - p.redOnlineSpend), advice: 'HKD 网购不收 1.95% 外币手续费。'
    }));
    const chill = r.bochk_chill.online;
    cards.push(progressCard({
      title: 'Chill World · 网购', rate: '5%', used: p.chillExtraReward, cap: chill.monthlyExtraRewardCapHKD,
      remainingSpend: (chill.monthlyExtraRewardCapHKD - p.chillExtraReward) / chill.extraRate,
      advice: '额外 4.6% 现金回赠按共享奖励池计算。'
    }));
  }

  if (state.region === 'OVERSEAS') {
    cards.push(progressCard({ title: 'AEON Purple · 海外', rate: '≈5% net', advice: '当前登记活动按 6% 积分等值 − 1% 手续费估算。' }));
    const chill = r.bochk_chill.overseas;
    cards.push(progressCard({
      title: 'Chill World · 海外/网上', rate: '≈3.05% net', used: p.chillExtraReward, cap: chill.monthlyExtraRewardCapHKD,
      remainingSpend: (chill.monthlyExtraRewardCapHKD - p.chillExtraReward) / chill.extraRate,
      advice: '以非 HKD 签账时扣除约 1.95% 手续费。'
    }));
    const red = r.hsbc_red.online;
    cards.push(progressCard({
      title: 'HSBC Red · 海外网购', rate: '≈2.05% net', used: Math.min(p.redOnlineSpend, red.monthlySpendCapHKD), cap: red.monthlySpendCapHKD,
      remainingSpend: Math.max(0, red.monthlySpendCapHKD - p.redOnlineSpend),
      advice: '日本 SUICA / FamilyMart 等指定商户应优先使用独立 8% 规则。'
    }));
    cards.push(progressCard({ title: 'Mox Credit · 海外后备', rate: '0% FX + Miles', advice: '高回赠池用完后的无外币手续费后备方案。' }));
  }

  panel.classList.remove('empty-state');
  panel.innerHTML = `<div class="section-heading"><div><p class="eyebrow">${state.region}</p><h2>${state.monthKey} 消费建议</h2></div></div><div class="reward-list">${cards.join('')}</div>`;
}

function renderTransactions(evaluated) {
  const body = $('#transactionTableBody');
  if (!evaluated.length) {
    body.innerHTML = '<tr><td colspan="8" class="muted">本月没有符合条件的信用卡消费。</td></tr>';
    return;
  }
  body.innerHTML = evaluated.map(tx => `<tr>
    <td>${formatDate(tx.date)}</td>
    <td>${tx.card.name}</td>
    <td>${tx.ledger}</td>
    <td><strong>${tx.merchant}</strong><br><span class="muted">${tx.originalMerchant || '—'}</span></td>
    <td>${tx.region}</td>
    <td>${tx.currency} ${tx.amount.toFixed(2)}</td>
    <td>${tx.label}<br><span class="muted">${tx.netRate != null ? `净 ${pct(tx.netRate)}` : ''}</span></td>
    <td>${money(tx.rewardHKD)}</td>
  </tr>`).join('');
}

async function handleWorkbook(file) {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: 'array', cellDates: true, dense: true });
  const sheetName = workbook.SheetNames[0];
  const rows = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], { defval: '' });
  state.transactions = parseRows(rows);
  const result = evaluate(state.transactions);
  state.sourceFile = file.name;

  const dateRange = state.sourceDateMin && state.sourceDateMax
    ? `${formatFullDate(state.sourceDateMin)} → ${formatFullDate(state.sourceDateMax)}`
    : '日期范围未知';
  $('#dataUpdated').textContent = `${state.monthKey || '—'} · ${file.name} · ${dateRange}`;
  $('#transactionCount').textContent = `${state.transactions.length} 笔`;
  $('#filterNote').textContent = `已纳入账本：${configuredLedgers().join(' + ')}；仅统计信用卡白名单消费`;
  renderTransactions(result.evaluated);
  renderSummary(result);

  localStorage.setItem('cardmax:lastMeta', JSON.stringify({
    file: file.name,
    month: state.monthKey,
    count: state.transactions.length,
    importedAt: new Date().toISOString()
  }));
}

function wireUI() {
  $('#syncButton').addEventListener('click', () => $('#fileInput').click());
  $('#fileInput').addEventListener('change', async (event) => {
    const [file] = event.target.files;
    if (!file) return;
    try {
      $('#syncButton').textContent = '读取中…';
      $('#syncButton').disabled = true;
      await handleWorkbook(file);
    } catch (error) {
      console.error(error);
      alert(`无法读取 iCost XLSX：${error.message}\n\n请保留该文件，我们会用它继续改进 importer。`);
    } finally {
      $('#syncButton').textContent = '同步 iCost';
      $('#syncButton').disabled = false;
      event.target.value = '';
    }
  });

  document.querySelectorAll('.region-tab').forEach(button => {
    button.addEventListener('click', () => {
      document.querySelectorAll('.region-tab').forEach(b => b.classList.remove('active'));
      button.classList.add('active');
      state.region = button.dataset.region;
      if (state.transactions.length) renderSummary(evaluate(state.transactions));
    });
  });
}

async function boot() {
  await loadConfig();
  wireUI();
  const meta = JSON.parse(localStorage.getItem('cardmax:lastMeta') || 'null');
  if (meta) $('#dataUpdated').textContent = `上次：${meta.month} · ${meta.file}`;
  if ('serviceWorker' in navigator) navigator.serviceWorker.register('./sw.js').catch(console.warn);
}

boot().catch(error => {
  console.error(error);
  $('#rulesVersion').textContent = '规则加载失败';
});
