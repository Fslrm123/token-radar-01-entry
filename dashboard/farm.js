// One farm plan per protocol, derived from the protocol's own record: its category, its chains,
// its TVL and its age. main.ts writes board.json's farm_steps with this same file, so the plan the
// page shows and the plan board.json carries are the same steps by construction. No protocol name
// is ever special-cased: the category table below decides the action, the TVL decides the capital,
// the main chain decides the gas, and the age decides the hold.

/** The capital one farm position needs, from the protocol's own TVL. */
export function capitalFor(tvlUsd) {
  if (tvlUsd >= 5_000_000_000) return 250;
  if (tvlUsd >= 1_000_000_000) return 150;
  if (tvlUsd >= 100_000_000) return 100;
  return 50;
}

/** How long to hold, from the protocol's age: younger protocols get a longer qualifying window. */
export function holdDaysFor(ageDays) {
  if (ageDays === null || ageDays === undefined) return 30;
  if (ageDays < 180) return 60;
  if (ageDays < 365) return 45;
  return 30;
}

/** Gas reality by chain: Ethereum costs real money per transaction, Solana almost nothing. */
export function gasFor(chain) {
  if (chain === 'Ethereum') return { perTx: '$8-15', setup: 'about $12' };
  if (chain === 'Solana') return { perTx: 'under $0.05', setup: 'under $0.10' };
  if (chain === 'Tron' || chain === 'Bitcoin') return { perTx: 'about $1-3', setup: 'about $2' };
  return { perTx: 'about $0.10-1', setup: 'about $0.50' };
}

/** The category's one action, in the words a farmer can follow. */
export function actionFor(p, capital, chain) {
  const c = (p.category || '').toLowerCase();
  const name = p.name;
  const table = [
    [['lend', 'cdp', 'collateral'], `Supply $${capital} of USDC to ${name} on ${chain} and keep the position open`],
    [['dex', 'amm'], `Provide $${capital} of liquidity to ${name}'s main pool on ${chain} and keep the position open`],
    [['yield aggregator', 'yield'], `Deposit $${capital} of USDC into a ${name} vault on ${chain} and keep the shares`],
    [['risk curator', 'curator', 'allocator', 'onchain capital'], `Deposit $${capital} of USDC into a curated ${name} vault on ${chain} and keep the shares`],
    [['rwa'], `Mint $${capital} of the yield-bearing asset through ${name} on ${chain} and hold it`],
    [['basis'], `Deposit $${capital} of USDC into the ${name} basis vault on ${chain} and keep the position open`],
    [['restak'], `Restake $${capital} of the chain's staking asset through ${name} and keep the receipt`],
    [['staking pool', 'staking'], `Stake $${capital} of the chain's staking asset through ${name} and keep the receipt`],
    [['perpetual', 'derivative'], `Deposit $${capital} of USDC as margin on ${name} and open one small hedge`],
    [['prediction', 'predict'], `Fund $${capital} and place one market position on ${name}`],
    [['stable'], `Mint or deposit $${capital} of the stable asset through ${name} on ${chain}`],
    [['insurance'], `Buy $${capital} of cover from ${name} on ${chain} and keep the policy`],
    [['payment'], `Top up $${capital} into ${name} on ${chain} and use it for one real payment`],
    [['launchpad'], `Deposit $${capital} of USDC into ${name} on ${chain} to qualify for an allocation`],
    [['option'], `Deposit $${capital} of USDC as collateral for one small options position on ${name}`],
    [['bridge'], `Bridge $${capital} of USDC to ${chain} through ${name} and use the bridged funds in its app`],
    [['chain'], `Use $${capital} in ${name}'s flagship app on its own chain and keep the position open`],
  ];
  for (const [keys, text] of table) {
    if (keys.some((k) => c.includes(k))) return text + '.';
  }
  return `Deposit $${capital} of USDC into ${name} on ${chain} and keep the position open.`;
}

/** The category's weekly action: what the wallet does every week to stay active, in its own words. */
export function weeklyFor(p, capital, chain) {
  const c = (p.category || '').toLowerCase();
  const name = p.name;
  const table = [
    [['lend', 'cdp', 'collateral'], `Borrow a small amount against the $${capital} supply, then repay it the same week, so the wallet shows both sides of the market`],
    [['dex', 'amm'], `Swap at least $10 through ${name}'s main pool, so the wallet records a trade every week`],
    [['yield aggregator', 'yield'], `Top up the ${name} vault by a small amount, or claim the yield and re-deposit it, so the position grows every week`],
    [['risk curator', 'curator', 'allocator', 'onchain capital'], `Top up the curated vault by a small amount, or move a little between its vaults, so the wallet stays active in ${name}'s records`],
    [['rwa'], `Check the yield accrual and hold: if the asset pays out, claim it and re-mint so the position compounds`],
    [['basis'], `Hold the basis position and check the funding rate once a week, so a turn against the trade is caught early`],
    [['restak'], `Check the restaking rewards once a week and restake them, so the position compounds`],
    [['staking pool', 'staking'], `Check the staking rewards once a week and restake them, so the position compounds`],
    [['perpetual', 'derivative'], `Open and close one small hedged position a week, keeping the margin far below the liquidation price`],
    [['prediction', 'predict'], `Place one small position a week on a market you have actually read, never a blind bet`],
    [['stable'], `Mint or redeem a small amount of the stable asset once a week, so the wallet stays active`],
    [['insurance'], `Check the policy once a week and top up the cover if the insured amount has grown`],
    [['payment'], `Use ${name} for one real payment a week, so the wallet shows genuine use`],
    [['launchpad'], `Check the launchpad once a week for a new allocation window, and deposit only inside it`],
    [['option'], `Roll one small options position a week, never more than the collateral allows`],
    [['bridge'], `Bridge a small amount once a week and use it in the destination app, so the wallet is active on both sides`],
    [['chain'], `Use ${name}'s flagship app once a week, so the wallet stays active on its own chain`],
  ];
  for (const [keys, text] of table) {
    if (keys.some((k) => c.includes(k))) return text + '.';
  }
  return `Do one qualifying action a week, such as a deposit, a swap or a vote, so the wallet stays active in ${name}'s records.`;
}

/** The category's risk, in one plain sentence: what actually loses the money. */
export function riskFor(p) {
  const c = (p.category || '').toLowerCase();
  const table = [
    [['lend', 'cdp', 'collateral'], `A borrow can be liquidated if the collateral falls: keep the loan well below the limit and never borrow the maximum`],
    [['dex', 'amm'], `Liquidity can lose value to impermanent loss if the pair moves far: size the position so a 50% move is affordable`],
    [['yield aggregator', 'yield'], `A vault is a smart contract: a bug can take the deposit, so never farm with money you cannot lose`],
    [['risk curator', 'curator', 'allocator', 'onchain capital'], `A curator's vaults carry the vaults' own risks: read what each vault holds before you deposit`],
    [['rwa'], `A real-world asset depends on its issuer and custodian: a failure there is not covered by the chain`],
    [['basis'], `A basis trade can lose money when funding turns negative for weeks: size it so a bad month is affordable`],
    [['restak'], `Restaked assets can be slashed if a validator misbehaves: spread the stake and keep some unstaked`],
    [['staking pool', 'staking'], `Staked assets can be slashed if a validator misbehaves: spread the stake and keep some unstaked`],
    [['perpetual', 'derivative'], `Leverage liquidates fast: keep the margin far above the maintenance level and never use full leverage`],
    [['prediction', 'predict'], `A prediction market can go to zero on a wrong call: stake only what the week can lose`],
    [['stable'], `A stable asset can depeg: never hold more in it than you can afford to see cut`],
    [['insurance'], `Cover pays only what the policy's terms say: read the exclusions before you rely on it`],
    [['payment'], `A payment app holds your funds between payments: keep only the week's spending in it`],
    [['launchpad'], `An allocation is not a return: the token can open below the sale price, so size for a total loss`],
    [['option'], `An option can expire worthless: pay only a premium you can lose in full`],
    [['bridge'], `A bridge holds funds in transit: bridge only what you need for the week`],
    [['chain'], `A new chain's apps can fail or be abandoned: keep the position small until it proves itself`],
  ];
  for (const [keys, text] of table) {
    if (keys.some((k) => c.includes(k))) return text + '.';
  }
  return `Every position here can go to zero: size it so a total loss is affordable.`;
}
function stepText(text, cost, time) {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: nine steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names, and never claims a points program or an airdrop the snapshot does not record. The weekly
 * action and the risk are the category's own, so a lender's week and a trader's week read
 * differently, and every plan names what can actually lose the money.
 */
export function farmStepsFor(p) {
  const chain = p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(p.age_days);
  const action = actionFor(p, capital, chain);
  const weekly = weeklyFor(p, capital, chain);
  const risk = riskFor(p);
  const secondChain = p.chains && p.chains.length > 1 ? p.chains[1] : null;
  const steps = [
    {
      text: 'Use a fresh wallet that holds only the funds you plan to farm, and keep its seed phrase offline',
      cost: 'no fee to set up',
      time: '5 minutes',
    },
    {
      text: action.replace(/\.$/, ''),
      cost: `$${capital} of capital and ${gas.setup} of gas`,
      time: '15 minutes to set up',
    },
    {
      text: weekly.replace(/\.$/, ''),
      cost: `${gas.perTx} of gas a week`,
      time: '10 minutes a week',
    },
    {
      text: `Hold the position for at least ${hold} days so the activity is counted in more than one snapshot`,
      cost: `the $${capital} stays in the position`,
      time: `${hold} days`,
    },
  ];
  if (secondChain) {
    steps.push({
      text: `Repeat the same position on ${secondChain} so the wallet is active on two of the protocol's chains`,
      cost: `a second $${capital} position, ${gasFor(secondChain).setup} of gas`,
      time: '15 minutes to set up',
    });
  } else {
    steps.push({
      text: 'Watch the protocol\'s own announcements channel for a points or rewards page, and open it only from the protocol\'s own site',
      cost: 'nothing to watch',
      time: '5 minutes a week',
    });
  }
  steps.push(
    {
      text: 'Read the protocol\'s own docs for the farming rules — a minimum deposit, a minimum number of active weeks — and keep the position above the minimum the whole time',
      cost: 'nothing to read',
      time: '10 minutes',
    },
    {
      text: `Know the risk: ${risk.replace(/\.$/, '')}`,
      cost: 'nothing but the reading',
      time: '5 minutes',
    },
    {
      text: 'Before you withdraw, open the protocol\'s points or rewards page from the link it publishes and claim only there, and never pay a fee to claim',
      cost: 'no fee to check',
      time: '10 minutes',
    },
    {
      text: 'Write the wallet, the dates and every transaction hash in a farm log, so you can repeat the position or unwind it cleanly',
      cost: 'nothing but the log',
      time: '5 minutes',
    },
  );
  return steps.map((s) => stepText(s.text, s.cost, s.time));
}
