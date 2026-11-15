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

/** A step as one string: its action, then its cost and time, within the gate's 20..600 characters. */
function stepText(text, cost, time) {
  let s = `${text} Cost: ${cost}. Time: ${time}.`;
  if (s.length > 600) s = `${s.slice(0, 596)}...`;
  if (s.length < 20) s = `${s} Hold the position and check the protocol's own page.`;
  return s;
}

/**
 * A protocol's farm plan: seven steps, each an action with a cost and a time. The plan is derived
 * from the protocol's own record (category, chains, TVL, age), never from a hand-written list of
 * names, and never claims a points program or an airdrop the snapshot does not record.
 */
export function farmStepsFor(p) {
  const chain = p.chains && p.chains.length > 0 ? p.chains[0] : 'its main chain';
  const gas = gasFor(chain);
  const capital = capitalFor(p.tvl_usd);
  const hold = holdDaysFor(p.age_days);
  const action = actionFor(p, capital, chain);
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
      text: 'Do one qualifying action each week, such as a deposit, a borrow, a swap or a vote, so the wallet stays active in the protocol\'s own records',
      cost: `about ${gas.perTx} of gas a week`,
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
