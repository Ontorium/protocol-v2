/**
 * Liquidation Test Script - 10 Cases
 *
 * Sends REAL transactions to deployed contracts on Anvil fork.
 * Usage:  ./scripts/run-liquidation-test.sh
 *
 * Output: scripts/liquidation-report.md
 */
// @ts-ignore
import { ethers } from 'hardhat';
import { BigNumber, Contract, Signer, providers } from 'ethers';
import * as fs from 'fs';
import * as path from 'path';

// ============================================================
// Addresses (Arbitrum Sepolia)
// ============================================================
const ADDR = {
  addressesProvider: '0x3F7ec1b283Af544A074948028B9541332f6b08E7',
  pool: '0xE434DE0da13DD43Ee83C5866049b13Aad9eCE71a',
  configurator: '0x27816e4a0b648D119bE87254c8dFCa99628c54a7',
  dataProvider: '0x75b5050F519A084CB927a247906FB4f554ED7467',
  aaveOracle: '0xdB1873F6FaFe74Ae7A1EE3CfCFECBAD4d6E66237',
  priceOracle: '0xaf713EADA340377232e5c1eDc26F3422Cf4E565c',
  agt: '0x408ae96165741d12f811efeba864f1ba8742cd8c',
  usdc: '0xC3437DA5e936D3449D6F0700A71847305e9357Be',
};

// ============================================================
// Constants
// ============================================================
const ONE_USD = BigNumber.from(10).pow(8);
const WAD = BigNumber.from(10).pow(18);
const RAY = BigNumber.from(10).pow(27);
const MAX_UINT = ethers.constants.MaxUint256;
const ZERO_ADDR = ethers.constants.AddressZero;
const AGT_UNIT = BigNumber.from(10).pow(18);
const USDC_UNIT = BigNumber.from(10).pow(6);
const GAS = { gasLimit: 5_000_000 };
const MIN_GAS_ETH = ethers.utils.parseEther('0.0005');
const IS_FORK = !!(process.env.USE_DEPLOYED || process.env.FORK);
// USDC mint() reverts on testnet (OwnableUnauthorizedAccount) - use transfer only.
// On fork mode, ensureTokens will use mint via impersonation anyway.
const USDC_TRANSFER_ONLY = !IS_FORK;

// ============================================================
// Skip / Resume support
// ============================================================
const PASSED_FILE = path.join(__dirname, '.liquidation-passed.json');

function loadPassedCases(): Set<number> {
  if (process.env.RESET_PASSED) {
    try { fs.unlinkSync(PASSED_FILE); } catch {}
    return new Set();
  }
  try { return new Set(JSON.parse(fs.readFileSync(PASSED_FILE, 'utf-8'))); }
  catch { return new Set(); }
}

function savePassedCase(idx: number) {
  const s = loadPassedCases();
  s.add(idx);
  fs.writeFileSync(PASSED_FILE, JSON.stringify(Array.from(s).sort()), 'utf-8');
}

// ============================================================
// Safe tx: gas check → staticCall → send
// ============================================================
async function sendTx(
  contract: Contract,
  method: string,
  args: any[],
  label: string
): Promise<providers.TransactionReceipt> {
  const signer = contract.signer;
  const bal = await signer.getBalance();
  if (bal.lt(MIN_GAS_ETH)) {
    throw new Error(`[GAS] ${label}: balance ${ethers.utils.formatEther(bal)} ETH`);
  }
  try {
    await contract.callStatic[method](...args, GAS);
  } catch (e: any) {
    throw new Error(`[STATIC] ${label}: ${e.reason || e.message?.slice(0, 200)}`);
  }
  const tx = await contract[method](...args, GAS);
  return tx.wait();
}

// ============================================================
// Types
// ============================================================
interface Snapshot {
  // User Account Data
  totalCollateralETH: BigNumber;
  totalDebtETH: BigNumber;
  availableBorrowsETH: BigNumber;
  healthFactor: BigNumber;
  liqThreshold: BigNumber;
  ltv: BigNumber;
  // Prices
  agtPrice: BigNumber;
  usdcPrice: BigNumber;
  // Reserve Data - AGT (collateral)
  agtLiquidityIndex: BigNumber;
  agtVariableBorrowIndex: BigNumber;
  agtLiquidityRate: BigNumber;
  agtVariableBorrowRate: BigNumber;
  agtAvailableLiquidity: BigNumber;
  agtTotalVariableDebt: BigNumber;
  // Reserve Data - USDC (debt)
  usdcLiquidityIndex: BigNumber;
  usdcVariableBorrowIndex: BigNumber;
  usdcLiquidityRate: BigNumber;
  usdcVariableBorrowRate: BigNumber;
  usdcAvailableLiquidity: BigNumber;
  usdcTotalVariableDebt: BigNumber;
  // Borrower positions
  borrowerAgtAToken: BigNumber;
  borrowerUsdcVarDebt: BigNumber;
  borrowerAgtUnderlying: BigNumber;
  borrowerUsdcUnderlying: BigNumber;
  // Liquidator balances
  liqAgtAToken: BigNumber;
  liqAgtUnderlying: BigNumber;
  liqUsdcUnderlying: BigNumber;
}

interface TestCase {
  name: string;
  whitelist: boolean;
  depositAGT: number;
  borrowUSDC: number;
  agtPriceAfter: BigNumber;
  expectedPct: string;
  expectRevert: boolean;
  decisionPath: string;
  useExactDebt?: boolean;  // pass exact borrow amount instead of MAX_UINT
}

interface TxInputs {
  depositAGT: string;       // formatted amount
  borrowUSDC: string;       // formatted amount
  agtPriceBefore: string;   // $1.0
  agtPriceAfter: string;    // e.g. $0.6
  liquidationCall: {
    collateralAsset: string;
    debtAsset: string;
    user: string;
    debtToCover: string;    // raw or "MAX_UINT256"
    receiveAToken: boolean;
  };
}

interface CaseResult {
  tc: TestCase;
  before?: Snapshot;
  after?: Snapshot;
  txHash?: string;
  txInputs?: TxInputs;
  passed: boolean;
  skipped?: boolean;
  debtPct?: string;
  collPct?: string;
  errorMsg?: string;
}

interface Actors {
  oracleAdmin: Signer;
  poolAdmin: Signer;
  borrower: Signer;
  liquidator: Signer;
  agtMinter: Signer;   // AGT uses minter role, not owner
  usdcOwner: Signer;
  borrowerAddr: string;
  liquidatorAddr: string;
}

// ============================================================
// Formatting
// ============================================================
const f8 = (v: BigNumber) => ethers.utils.formatUnits(v, 8);
const f18 = (v: BigNumber) => ethers.utils.formatUnits(v, 18);
const f6 = (v: BigNumber) => ethers.utils.formatUnits(v, 6);
const f27 = (v: BigNumber) => ethers.utils.formatUnits(v, 27);
const fHF = (v: BigNumber) => (v.gt(WAD.mul(100)) ? 'Infinity' : f18(v));

function pct(before: BigNumber, after: BigNumber): string {
  if (before.isZero()) return 'N/A';
  const bps = before.sub(after).mul(1000000).div(before);
  return (bps.toNumber() / 10000).toFixed(2);
}

function delta(before: BigNumber, after: BigNumber, fmt: (v: BigNumber) => string): string {
  const diff = after.sub(before);
  return diff.isNegative() ? fmt(diff) : `+${fmt(diff)}`;
}

// ============================================================
// Token helper: mint or transfer
// Tries mint first; if mint fails, transfers from provider balance
// ============================================================
const TOKEN_ABI = [
  'function mint(address to, uint256 amount)',
  'function mint(uint256 amount)',
  'function transfer(address to, uint256 amount) returns (bool)',
  'function balanceOf(address) view returns (uint256)',
];

async function ensureTokens(
  tokenAddr: string,
  provider: Signer,
  to: string,
  amount: BigNumber,
  label: string,
  transferOnly = false
) {
  const bal = await provider.getBalance();
  if (bal.lt(MIN_GAS_ETH)) {
    throw new Error(`[GAS] ${label}: balance ${ethers.utils.formatEther(bal)} ETH`);
  }

  const t = new ethers.Contract(tokenAddr, TOKEN_ABI, provider);
  const providerAddr = await provider.getAddress();

  // Check if target already has enough
  const targetBal: BigNumber = await t.balanceOf(to);
  if (targetBal.gte(amount)) return;
  const needed = amount.sub(targetBal);

  if (transferOnly) {
    // Transfer only (USDC/USDT)
    if (providerAddr.toLowerCase() !== to.toLowerCase()) {
      await (await t.transfer(to, needed, GAS)).wait();
    }
    return;
  }

  // Try mint first (AGT)
  let minted = false;
  try {
    await (await t['mint(address,uint256)'](to, needed, GAS)).wait();
    minted = true;
  } catch {
    try {
      await (await t['mint(uint256)'](needed, GAS)).wait();
      minted = true;
    } catch { /* mint not available, will use transfer */ }
  }

  if (minted && providerAddr.toLowerCase() !== to.toLowerCase()) {
    // mint(uint256) minted to provider, need to transfer
    const provBal: BigNumber = await t.balanceOf(providerAddr);
    if (provBal.gte(needed)) {
      await (await t.transfer(to, needed, GAS)).wait();
    }
  } else if (!minted) {
    // No mint available - transfer from provider
    await (await t.transfer(to, needed, GAS)).wait();
  }
}

// ============================================================
// Snapshot
// ============================================================
async function snap(
  dp: Contract,
  pool: Contract,
  oracle: Contract,
  agt: Contract,
  usdc: Contract,
  borrower: string,
  liquidator: string,
  agtATokenAddr: string
): Promise<Snapshot> {
  const agtAToken = new ethers.Contract(
    agtATokenAddr,
    ['function balanceOf(address) view returns (uint256)'],
    ethers.provider
  );

  const [acc, uColl, uDebt, rColl, rDebt, pAgt, pUsdc,
    bAgt, bUsdc, lAgt, lUsdc, lAgtA, bAgtA] = await Promise.all([
    pool.getUserAccountData(borrower),
    dp.getUserReserveData(ADDR.agt, borrower),
    dp.getUserReserveData(ADDR.usdc, borrower),
    dp.getReserveData(ADDR.agt),
    dp.getReserveData(ADDR.usdc),
    oracle.getAssetPrice(ADDR.agt),
    oracle.getAssetPrice(ADDR.usdc),
    agt.balanceOf(borrower),
    usdc.balanceOf(borrower),
    agt.balanceOf(liquidator),
    usdc.balanceOf(liquidator),
    agtAToken.balanceOf(liquidator),
    agtAToken.balanceOf(borrower),
  ]);

  return {
    totalCollateralETH: acc.totalCollateralETH,
    totalDebtETH: acc.totalDebtETH,
    availableBorrowsETH: acc.availableBorrowsETH,
    healthFactor: acc.healthFactor,
    liqThreshold: acc.currentLiquidationThreshold,
    ltv: acc.ltv,
    agtPrice: pAgt,
    usdcPrice: pUsdc,
    // AGT reserve
    agtLiquidityIndex: rColl.liquidityIndex,
    agtVariableBorrowIndex: rColl.variableBorrowIndex,
    agtLiquidityRate: rColl.liquidityRate,
    agtVariableBorrowRate: rColl.variableBorrowRate,
    agtAvailableLiquidity: rColl.availableLiquidity,
    agtTotalVariableDebt: rColl.totalVariableDebt,
    // USDC reserve
    usdcLiquidityIndex: rDebt.liquidityIndex,
    usdcVariableBorrowIndex: rDebt.variableBorrowIndex,
    usdcLiquidityRate: rDebt.liquidityRate,
    usdcVariableBorrowRate: rDebt.variableBorrowRate,
    usdcAvailableLiquidity: rDebt.availableLiquidity,
    usdcTotalVariableDebt: rDebt.totalVariableDebt,
    // Borrower
    borrowerAgtAToken: bAgtA,
    borrowerUsdcVarDebt: uDebt.currentVariableDebt,
    borrowerAgtUnderlying: bAgt,
    borrowerUsdcUnderlying: bUsdc,
    // Liquidator
    liqAgtAToken: lAgtA,
    liqAgtUnderlying: lAgt,
    liqUsdcUnderlying: lUsdc,
  };
}

// ============================================================
// Test Cases
// ============================================================
function getCases(): TestCase[] {
  return [
    {
      name: 'Case 1: Non-whitelist -> 50%',
      whitelist: false,
      depositAGT: 1000,
      borrowUSDC: 550,
      agtPriceAfter: BigNumber.from('60000000'),
      expectedPct: '50%',
      expectRevert: false,
      decisionPath: 'whitelist=false -> return 50%',
    },
    {
      name: 'Case 2: Whitelist + HF <= 0.95 -> 100%',
      whitelist: true,
      depositAGT: 1000,
      borrowUSDC: 550,
      agtPriceAfter: BigNumber.from('60000000'),
      expectedPct: '100%',
      expectRevert: false,
      decisionPath: 'whitelist=true -> HF(~0.818) <= 0.95 -> 100%',
    },
    {
      name: 'Case 3: Whitelist + HF > 0.95, Coll < $2000 -> 100%',
      whitelist: true,
      depositAGT: 200,
      borrowUSDC: 120,
      agtPriceAfter: BigNumber.from('78000000'),
      expectedPct: '100%',
      expectRevert: false,
      decisionPath: 'whitelist=true -> HF(~0.975) > 0.95 -> coll($156) < $2000 -> 100%',
    },
    {
      name: 'Case 4: Whitelist + HF > 0.95, Coll >= $2000, Debt < $2000 -> 100%',
      whitelist: true,
      depositAGT: 4000,
      borrowUSDC: 1600,
      agtPriceAfter: BigNumber.from('52000000'),
      expectedPct: '100%',
      expectRevert: false,
      decisionPath: 'whitelist=true -> HF(~0.975) > 0.95 -> coll($2080) >= $2000 -> debt($1600) < $2000 -> 100%',
    },
    {
      name: 'Case 5: Whitelist + HF > 0.95, Coll >= $2000, Debt >= $2000 -> 50%',
      whitelist: true,
      depositAGT: 5000,
      borrowUSDC: 3000,
      agtPriceAfter: BigNumber.from('78000000'),
      expectedPct: '50%',
      expectRevert: false,
      decisionPath: 'whitelist=true -> HF(~0.975) > 0.95 -> coll($3900) >= $2000 -> debt($3000) >= $2000 -> 50%',
    },
    {
      name: 'Case 6: HF >= 1.0 -> REVERT',
      whitelist: true,
      depositAGT: 1000,
      borrowUSDC: 500,
      agtPriceAfter: ONE_USD,
      expectedPct: 'REVERT',
      expectRevert: true,
      decisionPath: 'HF(~1.5) >= 1.0 -> REVERT (ValidationLogic)',
    },
    {
      name: 'Case 7: Boundary HF = 0.95 -> 100%',
      whitelist: true,
      depositAGT: 1000,
      borrowUSDC: 600,
      agtPriceAfter: BigNumber.from('76000000'),
      expectedPct: '100%',
      expectRevert: false,
      decisionPath: 'whitelist=true -> HF(0.95) <= 0.95 (boundary) -> 100%',
    },
    {
      name: 'Case 8: Boundary HF = 0.9625 (just above 0.95) -> 50%',
      whitelist: true,
      depositAGT: 5000,
      borrowUSDC: 3000,
      agtPriceAfter: BigNumber.from('77000000'),
      expectedPct: '50%',
      expectRevert: false,
      decisionPath: 'whitelist=true -> HF(~0.9625) > 0.95 -> coll($3850) >= $2000 -> debt($3000) >= $2000 -> 50%',
    },
    {
      name: 'Case 9: Boundary Coll = exactly $2000, Debt < $2000 -> 100%',
      whitelist: true,
      depositAGT: 4000,
      borrowUSDC: 1550,
      agtPriceAfter: BigNumber.from('50000000'),
      expectedPct: '100%',
      expectRevert: false,
      decisionPath: 'whitelist=true -> HF(~0.968) > 0.95 -> coll($2000) NOT < $2000 -> debt($1550) < $2000 -> 100%',
    },
    {
      name: 'Case 10: Boundary Debt = exactly $2000 -> 50%',
      whitelist: true,
      depositAGT: 5000,
      borrowUSDC: 2000,
      agtPriceAfter: BigNumber.from('52000000'),
      expectedPct: '50%',
      expectRevert: false,
      decisionPath: 'whitelist=true -> HF(~0.975) > 0.95 -> coll($2600) >= $2000 -> debt($2000) NOT < $2000 -> 50%',
    },
    {
      name: 'Case 11: Non-whitelist + explicit full debt -> capped at 50%',
      whitelist: false,
      depositAGT: 1000,
      borrowUSDC: 550,
      agtPriceAfter: BigNumber.from('60000000'),
      expectedPct: '50%',
      expectRevert: false,
      decisionPath: 'whitelist=false + debtToCover=100% of debt -> capped at 50%',
      useExactDebt: true,
    },
  ];
}

// ============================================================
// Markdown Report Builder
// ============================================================
class Report {
  private lines: string[] = [];
  h1(t: string) { this.lines.push(`# ${t}\n`); }
  h2(t: string) { this.lines.push(`## ${t}\n`); }
  h3(t: string) { this.lines.push(`### ${t}\n`); }
  h4(t: string) { this.lines.push(`#### ${t}\n`); }
  p(t: string) { this.lines.push(`${t}\n`); }
  br() { this.lines.push(''); }
  table(headers: string[], rows: string[][]) {
    this.lines.push('| ' + headers.join(' | ') + ' |');
    this.lines.push('| ' + headers.map(() => '---').join(' | ') + ' |');
    for (const r of rows) this.lines.push('| ' + r.join(' | ') + ' |');
    this.lines.push('');
  }

  detailedComparison(b: Snapshot, a: Snapshot) {
    // 1) User Account Data
    this.h4('User Account Data (Borrower)');
    this.table(
      ['Field', 'Before', 'After', 'Change'],
      [
        ['Health Factor', fHF(b.healthFactor), fHF(a.healthFactor), delta(b.healthFactor, a.healthFactor, f18)],
        ['Total Collateral (USD)', `$${f8(b.totalCollateralETH)}`, `$${f8(a.totalCollateralETH)}`, delta(b.totalCollateralETH, a.totalCollateralETH, f8)],
        ['Total Debt (USD)', `$${f8(b.totalDebtETH)}`, `$${f8(a.totalDebtETH)}`, delta(b.totalDebtETH, a.totalDebtETH, f8)],
        ['Available Borrows (USD)', `$${f8(b.availableBorrowsETH)}`, `$${f8(a.availableBorrowsETH)}`, delta(b.availableBorrowsETH, a.availableBorrowsETH, f8)],
        ['Liq Threshold (bps)', b.liqThreshold.toString(), a.liqThreshold.toString(), '-'],
        ['LTV (bps)', b.ltv.toString(), a.ltv.toString(), '-'],
      ]
    );

    // 2) Prices
    this.h4('Oracle Prices');
    this.table(
      ['Asset', 'Before', 'After', 'Change'],
      [
        ['AGT', `$${f8(b.agtPrice)}`, `$${f8(a.agtPrice)}`, delta(b.agtPrice, a.agtPrice, f8)],
        ['USDC', `$${f8(b.usdcPrice)}`, `$${f8(a.usdcPrice)}`, delta(b.usdcPrice, a.usdcPrice, f8)],
      ]
    );

    // 3) AGT Reserve (Collateral)
    this.h4('AGT Reserve (Collateral)');
    this.table(
      ['Field', 'Before', 'After', 'Change'],
      [
        ['Available Liquidity', `${f18(b.agtAvailableLiquidity)} AGT`, `${f18(a.agtAvailableLiquidity)} AGT`, `${delta(b.agtAvailableLiquidity, a.agtAvailableLiquidity, f18)}`],
        ['Total Variable Debt', `${f18(b.agtTotalVariableDebt)} AGT`, `${f18(a.agtTotalVariableDebt)} AGT`, delta(b.agtTotalVariableDebt, a.agtTotalVariableDebt, f18)],
        ['Liquidity Index', f27(b.agtLiquidityIndex), f27(a.agtLiquidityIndex), delta(b.agtLiquidityIndex, a.agtLiquidityIndex, f27)],
        ['Variable Borrow Index', f27(b.agtVariableBorrowIndex), f27(a.agtVariableBorrowIndex), delta(b.agtVariableBorrowIndex, a.agtVariableBorrowIndex, f27)],
        ['Liquidity Rate (APY)', f27(b.agtLiquidityRate), f27(a.agtLiquidityRate), delta(b.agtLiquidityRate, a.agtLiquidityRate, f27)],
        ['Variable Borrow Rate', f27(b.agtVariableBorrowRate), f27(a.agtVariableBorrowRate), delta(b.agtVariableBorrowRate, a.agtVariableBorrowRate, f27)],
      ]
    );

    // 4) USDC Reserve (Debt)
    this.h4('USDC Reserve (Debt)');
    this.table(
      ['Field', 'Before', 'After', 'Change'],
      [
        ['Available Liquidity', `${f6(b.usdcAvailableLiquidity)} USDC`, `${f6(a.usdcAvailableLiquidity)} USDC`, `${delta(b.usdcAvailableLiquidity, a.usdcAvailableLiquidity, f6)}`],
        ['Total Variable Debt', `${f6(b.usdcTotalVariableDebt)} USDC`, `${f6(a.usdcTotalVariableDebt)} USDC`, delta(b.usdcTotalVariableDebt, a.usdcTotalVariableDebt, f6)],
        ['Liquidity Index', f27(b.usdcLiquidityIndex), f27(a.usdcLiquidityIndex), delta(b.usdcLiquidityIndex, a.usdcLiquidityIndex, f27)],
        ['Variable Borrow Index', f27(b.usdcVariableBorrowIndex), f27(a.usdcVariableBorrowIndex), delta(b.usdcVariableBorrowIndex, a.usdcVariableBorrowIndex, f27)],
        ['Liquidity Rate (APY)', f27(b.usdcLiquidityRate), f27(a.usdcLiquidityRate), delta(b.usdcLiquidityRate, a.usdcLiquidityRate, f27)],
        ['Variable Borrow Rate', f27(b.usdcVariableBorrowRate), f27(a.usdcVariableBorrowRate), delta(b.usdcVariableBorrowRate, a.usdcVariableBorrowRate, f27)],
      ]
    );

    // 5) AToken & Debt Token Balances
    const totalDebtB = b.borrowerUsdcVarDebt;
    const totalDebtA = a.borrowerUsdcVarDebt;
    this.h4('Borrower Token Balances');
    this.table(
      ['Token', 'Before', 'After', 'Change', '% Change'],
      [
        ['aAGT (AToken)', `${f18(b.borrowerAgtAToken)} AGT`, `${f18(a.borrowerAgtAToken)} AGT`, delta(b.borrowerAgtAToken, a.borrowerAgtAToken, f18), `${pct(b.borrowerAgtAToken, a.borrowerAgtAToken)}%`],
        ['USDC Variable Debt', `${f6(totalDebtB)} USDC`, `${f6(totalDebtA)} USDC`, delta(totalDebtB, totalDebtA, f6), `${pct(totalDebtB, totalDebtA)}%`],
        ['AGT (underlying)', `${f18(b.borrowerAgtUnderlying)} AGT`, `${f18(a.borrowerAgtUnderlying)} AGT`, delta(b.borrowerAgtUnderlying, a.borrowerAgtUnderlying, f18), '-'],
        ['USDC (underlying)', `${f6(b.borrowerUsdcUnderlying)} USDC`, `${f6(a.borrowerUsdcUnderlying)} USDC`, delta(b.borrowerUsdcUnderlying, a.borrowerUsdcUnderlying, f6), '-'],
      ]
    );

    // 6) Liquidator Balances
    this.h4('Liquidator Token Balances');
    this.table(
      ['Token', 'Before', 'After', 'Change'],
      [
        ['aAGT (AToken)', `${f18(b.liqAgtAToken)} AGT`, `${f18(a.liqAgtAToken)} AGT`, delta(b.liqAgtAToken, a.liqAgtAToken, f18)],
        ['AGT (underlying)', `${f18(b.liqAgtUnderlying)} AGT`, `${f18(a.liqAgtUnderlying)} AGT`, delta(b.liqAgtUnderlying, a.liqAgtUnderlying, f18)],
        ['USDC (underlying)', `${f6(b.liqUsdcUnderlying)} USDC`, `${f6(a.liqUsdcUnderlying)} USDC`, delta(b.liqUsdcUnderlying, a.liqUsdcUnderlying, f6)],
      ]
    );

    // 7) Liquidation Summary
    const debtLiqPct = pct(totalDebtB, totalDebtA);
    const collLiqPct = pct(b.borrowerAgtAToken, a.borrowerAgtAToken);
    this.h4('Liquidation Summary');
    this.table(
      ['Metric', 'Value'],
      [
        ['Collateral Seized (AGT)', `${f18(b.borrowerAgtAToken.sub(a.borrowerAgtAToken))} AGT`],
        ['Debt Repaid (USDC)', `${f6(totalDebtB.sub(totalDebtA))} USDC`],
        ['**Debt Liquidated %**', `**${debtLiqPct}%**`],
        ['**Collateral Seized %**', `**${collLiqPct}%**`],
        ['Liquidator AGT Received', `${f18(a.liqAgtUnderlying.sub(b.liqAgtUnderlying))} AGT`],
        ['Liquidator USDC Spent', `${f6(b.liqUsdcUnderlying.sub(a.liqUsdcUnderlying))} USDC`],
      ]
    );
  }

  toString() { return this.lines.join('\n'); }
}

// ============================================================
// Cleanup helper
// ============================================================
async function cleanupPosition(
  pool: Contract,
  dp: Contract,
  usdc: Contract,
  usdcOwner: Signer,
  borrower: Signer,
  priceOracle: Contract,
  priceAdmin: Signer,
  borrowerAddr: string
) {
  await sendTx(priceOracle.connect(priceAdmin), 'setAssetPrice', [ADDR.agt, ONE_USD], 'cleanup: resetPrice');

  const ud = await dp.getUserReserveData(ADDR.usdc, borrowerAddr);
  if (ud.currentVariableDebt.gt(0)) {
    const amt = ud.currentVariableDebt.mul(102).div(100);
    await ensureTokens(ADDR.usdc, usdcOwner, borrowerAddr, amt, 'cleanup: USDC for repay', USDC_TRANSFER_ONLY);
    await sendTx(usdc.connect(borrower), 'approve', [ADDR.pool, MAX_UINT], 'cleanup: approve USDC');
    await sendTx(pool.connect(borrower), 'repay', [ADDR.usdc, MAX_UINT, 2, borrowerAddr], 'cleanup: repay');
  }

  const uc = await dp.getUserReserveData(ADDR.agt, borrowerAddr);
  if (uc.currentATokenBalance.gt(0)) {
    await sendTx(pool.connect(borrower), 'withdraw', [ADDR.agt, MAX_UINT, borrowerAddr], 'cleanup: withdraw');
  }
}

// ============================================================
// Resolve actors
// ============================================================
function getDirectProvider(): providers.JsonRpcProvider {
  const url = process.env.HARDHAT_NETWORK_URL || 'http://127.0.0.1:8545';
  return new ethers.providers.JsonRpcProvider(url);
}

async function impersonate(
  addr: string,
  funder: Signer,
  directProvider: providers.JsonRpcProvider
): Promise<Signer> {
  await directProvider.send('anvil_impersonateAccount', [addr]);
  await (await funder.sendTransaction({ to: addr, value: ethers.utils.parseEther('10') })).wait();
  return directProvider.getSigner(addr);
}

async function resolveActors(aaveOracle: Contract): Promise<Actors> {
  const isFork = !!process.env.USE_DEPLOYED || !!process.env.FORK;
  const signers = await ethers.getSigners();

  if (isFork) {
    console.log('  MODE: Anvil fork');
    const directProvider = getDirectProvider();
    const admin = signers[0];
    const adminAddr = await admin.getAddress();

    const ap = await ethers.getContractAt('LendingPoolAddressesProvider', ADDR.addressesProvider);
    const poolAdminAddr: string = await ap.getPoolAdmin();
    const oracleOwnerAddr: string = await aaveOracle.owner();

    // Use signers[0] directly if it matches on-chain admin; impersonate only if different
    let oracleAdmin: Signer = admin;
    let poolAdmin: Signer = admin;

    if (poolAdminAddr.toLowerCase() !== adminAddr.toLowerCase()) {
      console.log(`  Pool Admin differs from signers[0], impersonating ${poolAdminAddr}`);
      await impersonate(poolAdminAddr, admin, directProvider);
      poolAdmin = directProvider.getSigner(poolAdminAddr);
    }
    if (oracleOwnerAddr.toLowerCase() !== adminAddr.toLowerCase()) {
      console.log(`  Oracle Owner differs from signers[0], impersonating ${oracleOwnerAddr}`);
      await impersonate(oracleOwnerAddr, admin, directProvider);
      oracleAdmin = directProvider.getSigner(oracleOwnerAddr);
    }

    // AGT: impersonate on-chain minter (mnemonic accounts are NOT minters)
    let agtMinter: Signer = admin;
    try {
      const mintersAbi = ['function minters() view returns (address[])'];
      const minters: string[] = await new ethers.Contract(ADDR.agt, mintersAbi, ethers.provider).minters();
      // Check if any signer is already a minter
      let found = false;
      for (const s of signers.slice(0, 5)) {
        const a = await s.getAddress();
        if (minters.some(m => m.toLowerCase() === a.toLowerCase())) {
          agtMinter = s;
          console.log(`  AGT Minter:    ${a} (signer)`);
          found = true;
          break;
        }
      }
      // If no signer is a minter, impersonate the first on-chain minter
      if (!found && minters.length > 0) {
        const agtMinterAddr = minters[0];
        await impersonate(agtMinterAddr, admin, directProvider);
        agtMinter = directProvider.getSigner(agtMinterAddr);
        console.log(`  AGT Minter:    ${agtMinterAddr} (impersonated)`);
      }
    } catch { /* use admin as fallback */ }

    // USDC: impersonate owner for minting in fork mode
    const ownableAbi = ['function owner() view returns (address)'];
    const usdcOwnerAddr: string = await new ethers.Contract(ADDR.usdc, ownableAbi, ethers.provider).owner();
    let usdcOwner: Signer = admin;
    if (usdcOwnerAddr.toLowerCase() !== adminAddr.toLowerCase()) {
      console.log(`  USDC Owner differs from signers[0], impersonating ${usdcOwnerAddr}`);
      await impersonate(usdcOwnerAddr, admin, directProvider);
      usdcOwner = directProvider.getSigner(usdcOwnerAddr);
    }

    console.log(`  Admin:         ${adminAddr}`);
    console.log(`  USDC Owner:    ${usdcOwnerAddr}`);
    console.log(`  Pool Admin:    ${poolAdminAddr}`);
    console.log(`  Oracle Owner:  ${oracleOwnerAddr}`);
    console.log(`  Borrower:      ${await signers[1].getAddress()}`);
    console.log(`  Liquidator:    ${await signers[2].getAddress()}`);

    return {
      oracleAdmin, poolAdmin,
      agtMinter, usdcOwner,
      borrower: signers[1], liquidator: signers[2],
      borrowerAddr: await signers[1].getAddress(),
      liquidatorAddr: await signers[2].getAddress(),
    };
  } else {
    console.log('  MODE: Testnet (mnemonic accounts)');
    const admin = signers[0];
    const adminAddr = await admin.getAddress();

    // Find AGT minter among signers
    let agtMinter: Signer = admin;
    try {
      const mintersAbi = ['function minters() view returns (address[])'];
      const minters: string[] = await new ethers.Contract(ADDR.agt, mintersAbi, ethers.provider).minters();
      for (const s of signers.slice(0, 5)) {
        const a = await s.getAddress();
        if (minters.some(m => m.toLowerCase() === a.toLowerCase())) {
          agtMinter = s;
          console.log(`  AGT Minter:    ${a}`);
          break;
        }
      }
    } catch { /* use admin as fallback */ }

    console.log(`  Admin:         ${adminAddr}`);
    console.log(`  Borrower:      ${await signers[1].getAddress()}`);
    console.log(`  Liquidator:    ${await signers[2].getAddress()}`);

    return {
      oracleAdmin: admin, poolAdmin: admin,
      agtMinter, usdcOwner: admin,
      borrower: signers[1], liquidator: signers[2],
      borrowerAddr: await signers[1].getAddress(),
      liquidatorAddr: await signers[2].getAddress(),
    };
  }
}

// ============================================================
// Main
// ============================================================
async function main() {
  const report = new Report();
  const nowDate = new Date();
  const now = nowDate.toISOString().slice(0, 19).replace('T', ' ');
  const fileTs = nowDate.toISOString().slice(0, 19).replace(/[T:]/g, '-');

  const pool = await ethers.getContractAt('LendingPool', ADDR.pool);
  const cfg = await ethers.getContractAt('LendingPoolConfigurator', ADDR.configurator);
  const dp = await ethers.getContractAt('AaveProtocolDataProvider', ADDR.dataProvider);
  const aaveOracle = await ethers.getContractAt('AaveOracle', ADDR.aaveOracle);
  const priceOracle = await ethers.getContractAt('PriceOracle', ADDR.priceOracle);
  const agt = await ethers.getContractAt('MintableERC20', ADDR.agt);
  const usdc = await ethers.getContractAt('MintableERC20', ADDR.usdc);

  // Get aToken address for AGT
  const agtReserveTokens = await dp.getReserveTokensAddresses(ADDR.agt);
  const agtATokenAddr = agtReserveTokens.aTokenAddress;
  console.log(`  AGT aToken: ${agtATokenAddr}`);

  const actors = await resolveActors(aaveOracle);
  console.log(`  Borrower:   ${actors.borrowerAddr}`);
  console.log(`  Liquidator: ${actors.liquidatorAddr}`);

  // ---- Report header ----
  const isFork = IS_FORK;
  report.h1('Whitelist Liquidation Test Report');
  report.p(`**Date:** ${now}`);
  report.p(`**Network:** ${isFork ? 'Anvil fork of Arbitrum Sepolia' : 'Arbitrum Sepolia'}`);
  report.p(`**Borrower:** \`${actors.borrowerAddr}\``);
  report.p(`**Liquidator:** \`${actors.liquidatorAddr}\``);
  report.br();
  report.p('**Collateral:** AGT (18 decimals, LTV 65%, LiqThreshold 75%, LiqBonus 5%)');
  report.p('**Debt:** USDC (6 decimals, price $1)');
  report.p('**Constants:** USD_UNIT=1e8 | FULL_LIQUIDATION_HF_THRESHOLD=0.95e18 | FULL_LIQUIDATION_BASE_THRESHOLD=$2000');
  report.br();

  // ---- Oracle fix ----
  console.log('\nSetting up oracle...');
  const src = await aaveOracle.getSourceOfAsset(ADDR.agt);
  if (src !== ZERO_ADDR) {
    console.log('  Switching to fallback PriceOracle (1e8 scale)...');
    await sendTx(aaveOracle.connect(actors.oracleAdmin), 'setAssetSources',
      [[ADDR.agt, ADDR.usdc], [ZERO_ADDR, ZERO_ADDR]], 'setup: setAssetSources');
  }
  await sendTx(priceOracle.connect(actors.oracleAdmin), 'setAssetPrice', [ADDR.agt, ONE_USD], 'setup: AGT price');
  await sendTx(priceOracle.connect(actors.oracleAdmin), 'setAssetPrice', [ADDR.usdc, ONE_USD], 'setup: USDC price');
  console.log(`  AGT=$${f8(await aaveOracle.getAssetPrice(ADDR.agt))}, USDC=$${f8(await aaveOracle.getAssetPrice(ADDR.usdc))}`);

  // ---- USDC liquidity for borrowing ----
  const resDebt = await dp.getReserveData(ADDR.usdc);
  const needed = USDC_UNIT.mul(5000);
  if (resDebt.availableLiquidity.lt(needed)) {
    const dep = needed.sub(resDebt.availableLiquidity);
    console.log(`  Depositing ${f6(dep)} USDC liquidity...`);
    await ensureTokens(ADDR.usdc, actors.usdcOwner, actors.liquidatorAddr, dep, 'setup: USDC liquidity', USDC_TRANSFER_ONLY);
    await sendTx(usdc.connect(actors.liquidator), 'approve', [ADDR.pool, MAX_UINT], 'setup: USDC approve (liq)');
    await sendTx(pool.connect(actors.liquidator), 'deposit', [ADDR.usdc, dep, actors.liquidatorAddr, 0], 'setup: USDC deposit');
  }
  console.log('  Setup complete.\n');

  // ---- Pre-approve ----
  await sendTx(agt.connect(actors.borrower), 'approve', [ADDR.pool, MAX_UINT], 'setup: AGT approve (borrower)');
  await sendTx(usdc.connect(actors.borrower), 'approve', [ADDR.pool, MAX_UINT], 'setup: USDC approve (borrower)');
  await sendTx(usdc.connect(actors.liquidator), 'approve', [ADDR.pool, MAX_UINT], 'setup: USDC approve (liq)');

  // ---- Run cases ----
  const cases = getCases();
  const results: CaseResult[] = [];
  const passedBefore = loadPassedCases();

  for (let i = 0; i < cases.length; i++) {
    const c = cases[i];

    // Skip previously passed cases
    if (passedBefore.has(i)) {
      console.log(`[${i + 1}/${cases.length}] ${c.name} — SKIPPED (previously passed)`);
      results.push({ tc: c, passed: true, skipped: true });
      continue;
    }

    console.log(`[${i + 1}/${cases.length}] ${c.name}`);

    try {
      // Step 1: Cleanup previous position
      console.log('  step: cleanup');
      await cleanupPosition(pool, dp, usdc, actors.usdcOwner, actors.borrower, priceOracle, actors.oracleAdmin, actors.borrowerAddr);

      // Step 2: Whitelist toggle
      console.log('  step: whitelist');
      const isWL = await pool.isLiquidationWhitelisted(actors.liquidatorAddr);
      if (c.whitelist && !isWL) {
        await sendTx(cfg.connect(actors.poolAdmin), 'setLiquidationWhitelist',
          [actors.liquidatorAddr, true], `case ${i+1}: whitelist ON`);
      } else if (!c.whitelist && isWL) {
        await sendTx(cfg.connect(actors.poolAdmin), 'setLiquidationWhitelist',
          [actors.liquidatorAddr, false], `case ${i+1}: whitelist OFF`);
      }

      // Step 3: Reset price, deposit AGT, borrow USDC
      console.log('  step: price reset');
      await sendTx(priceOracle.connect(actors.oracleAdmin), 'setAssetPrice',
        [ADDR.agt, ONE_USD], `case ${i+1}: price reset`);

      console.log(`  step: mint ${c.depositAGT} AGT`);
      const depAmt = AGT_UNIT.mul(c.depositAGT);
      await ensureTokens(ADDR.agt, actors.agtMinter, actors.borrowerAddr, depAmt, `case ${i+1}: AGT for borrower`);

      console.log('  step: deposit AGT');
      await sendTx(pool.connect(actors.borrower), 'deposit',
        [ADDR.agt, depAmt, actors.borrowerAddr, 0], `case ${i+1}: deposit AGT`);

      console.log(`  step: borrow ${c.borrowUSDC} USDC`);
      const borAmt = USDC_UNIT.mul(c.borrowUSDC);
      await sendTx(pool.connect(actors.borrower), 'borrow',
        [ADDR.usdc, borAmt, 2, 0, actors.borrowerAddr], `case ${i+1}: borrow USDC`);

      // Step 4: Drop AGT price
      console.log(`  step: price drop AGT=$${f8(c.agtPriceAfter)}`);
      await sendTx(priceOracle.connect(actors.oracleAdmin), 'setAssetPrice',
        [ADDR.agt, c.agtPriceAfter], `case ${i+1}: price drop`);

      // Step 4.5: Ensure USDC for liquidator BEFORE snapshot so balance changes are accurate
      console.log('  step: ensure USDC for liquidator');
      await ensureTokens(ADDR.usdc, actors.usdcOwner, actors.liquidatorAddr, USDC_UNIT.mul(c.borrowUSDC * 2), `case ${i+1}: USDC for liquidator`, USDC_TRANSFER_ONLY);

      // Step 5: Before snapshot
      const before = await snap(dp, pool, aaveOracle, agt, usdc, actors.borrowerAddr, actors.liquidatorAddr, agtATokenAddr);
      console.log(`  HF=${fHF(before.healthFactor)}`);

      // Build txInputs for the report
      const buildTxInputs = (debtToCoverVal: BigNumber): TxInputs => ({
        depositAGT: `${c.depositAGT} AGT`,
        borrowUSDC: `${c.borrowUSDC} USDC`,
        agtPriceBefore: '$1.0',
        agtPriceAfter: `$${f8(c.agtPriceAfter)}`,
        liquidationCall: {
          collateralAsset: ADDR.agt,
          debtAsset: ADDR.usdc,
          user: actors.borrowerAddr,
          debtToCover: debtToCoverVal.eq(MAX_UINT) ? 'type(uint256).max' : `${f6(debtToCoverVal)} USDC`,
          receiveAToken: false,
        },
      });

      if (c.expectRevert) {
        // For revert cases: use callStatic to verify revert, then optionally send to confirm
        let reverted = false;
        const revertDebtToCover = MAX_UINT;
        try {
          await pool.connect(actors.liquidator).callStatic.liquidationCall(
            ADDR.agt, ADDR.usdc, actors.borrowerAddr, revertDebtToCover, false, GAS
          );
          // If callStatic succeeds, try actual tx to see if it reverts on-chain
          try {
            const tx = await pool.connect(actors.liquidator).liquidationCall(
              ADDR.agt, ADDR.usdc, actors.borrowerAddr, revertDebtToCover, false, GAS
            );
            const receipt = await tx.wait();
            if (receipt.status === 0) reverted = true;
          } catch {
            reverted = true;
          }
        } catch {
          reverted = true;
        }
        console.log(`  ${reverted ? 'PASSED' : 'FAILED'}: ${reverted ? 'reverted as expected' : 'did NOT revert'}`);
        results.push({ tc: c, before, passed: reverted, txInputs: buildTxInputs(revertDebtToCover), errorMsg: reverted ? 'Reverted as expected' : 'Did not revert' });
        if (reverted) savePassedCase(i);
      } else {
        console.log('  step: liquidationCall');
        const debtToCover = c.useExactDebt ? USDC_UNIT.mul(c.borrowUSDC) : MAX_UINT;
        if (c.useExactDebt) console.log(`  debtToCover: ${c.borrowUSDC} USDC (exact)`);
        const receipt = await sendTx(pool.connect(actors.liquidator), 'liquidationCall',
          [ADDR.agt, ADDR.usdc, actors.borrowerAddr, debtToCover, false], `case ${i+1}: liquidationCall`);

        // After snapshot
        const after = await snap(dp, pool, aaveOracle, agt, usdc, actors.borrowerAddr, actors.liquidatorAddr, agtATokenAddr);

        const debtPctVal = pct(before.borrowerUsdcVarDebt, after.borrowerUsdcVarDebt);
        const collPctVal = pct(before.borrowerAgtAToken, after.borrowerAgtAToken);
        const debtPctNum = parseFloat(debtPctVal);

        let ok = false;
        if (c.expectedPct === '100%') ok = debtPctNum >= 99.5;
        else if (c.expectedPct === '50%') ok = debtPctNum >= 49.0 && debtPctNum <= 51.0;

        console.log(`  ${ok ? 'PASSED' : 'FAILED'}: debt=${debtPctVal}%, coll=${collPctVal}% (expected ${c.expectedPct})`);
        results.push({
          tc: c, before, after,
          txHash: receipt.transactionHash,
          txInputs: buildTxInputs(debtToCover),
          passed: ok, debtPct: debtPctVal, collPct: collPctVal,
        });
        if (ok) savePassedCase(i);
      }
    } catch (e: any) {
      console.log(`  ERROR: ${e.message?.slice(0, 200)}`);
      results.push({ tc: c, passed: false, errorMsg: e.message?.slice(0, 300) });
    }
  }

  // Final cleanup (only if we ran any cases)
  if (results.some(r => !r.skipped)) {
    await cleanupPosition(pool, dp, usdc, actors.usdcOwner, actors.borrower, priceOracle, actors.oracleAdmin, actors.borrowerAddr);
  }

  // ================================================================
  // Build Report
  // ================================================================
  report.h2('Summary');
  report.table(
    ['#', 'Case', 'WL', 'HF (before)', 'Expected', 'Debt Liq%', 'Coll Seized%', 'Result'],
    results.map((r, i) => [
      `${i + 1}`,
      r.tc.name.replace(/^Case \d+: /, ''),
      r.tc.whitelist ? 'Y' : 'N',
      r.before ? fHF(r.before.healthFactor) : '-',
      r.tc.expectedPct,
      r.skipped ? 'SKIP' : (r.debtPct ? `${r.debtPct}%` : (r.tc.expectRevert ? 'REVERT' : 'ERROR')),
      r.skipped ? '-' : (r.collPct ? `${r.collPct}%` : '-'),
      r.skipped ? '**SKIP**' : (r.passed ? '**PASS**' : '**FAIL**'),
    ])
  );
  const passedCount = results.filter((r) => r.passed).length;
  const skippedCount = results.filter((r) => r.skipped).length;
  const ranCount = results.length - skippedCount;
  report.p(`**Result: ${passedCount}/${results.length} passed** (${skippedCount} skipped, ${ranCount} executed)`);
  report.br();

  // ---- Detailed Results ----
  report.h2('Detailed Results');
  report.br();

  for (let i = 0; i < results.length; i++) {
    const r = results[i];
    report.h2(`${r.tc.name}`);

    if (r.skipped) {
      report.p(`**Result:** SKIPPED (previously passed)`);
      report.p('---');
      report.br();
      continue;
    }

    report.table(
      ['Parameter', 'Value'],
      [
        ['Whitelist', r.tc.whitelist ? 'Yes' : 'No'],
        ['Collateral Deposit', `${r.tc.depositAGT} AGT`],
        ['Debt Borrow', `${r.tc.borrowUSDC} USDC`],
        ['AGT Price (after drop)', `$${f8(r.tc.agtPriceAfter)}`],
        ['Decision Path', r.tc.decisionPath],
        ['Expected Liquidation', r.tc.expectedPct],
      ]
    );

    // Transaction Inputs
    if (r.txInputs) {
      const ti = r.txInputs;
      report.h4('Transaction Inputs');
      report.table(['Step', 'Function', 'Key Params'], [
        ['1. Deposit', `pool.deposit(asset, amount, onBehalfOf, referralCode)`, `asset=\`${ADDR.agt}\`, amount=${ti.depositAGT}, onBehalfOf=borrower`],
        ['2. Borrow', `pool.borrow(asset, amount, rateMode, referralCode, onBehalfOf)`, `asset=\`${ADDR.usdc}\`, amount=${ti.borrowUSDC}, rateMode=2(variable)`],
        ['3. Price Drop', `priceOracle.setAssetPrice(asset, price)`, `asset=\`${ADDR.agt}\`, price=${ti.agtPriceAfter} (from ${ti.agtPriceBefore})`],
        ['4. Liquidation', `pool.liquidationCall(col, debt, user, debtToCover, receiveAToken)`,
          `col=\`${ti.liquidationCall.collateralAsset}\`, debt=\`${ti.liquidationCall.debtAsset}\`, user=\`${ti.liquidationCall.user}\`, debtToCover=**${ti.liquidationCall.debtToCover}**, receiveAToken=${ti.liquidationCall.receiveAToken}`],
      ]);
    }

    if (r.tc.expectRevert) {
      report.p(`**Result:** ${r.passed ? 'PASS - Reverted as expected' : 'FAIL - Did NOT revert'}`);
      if (r.before) {
        report.h4('State (before attempted liquidation)');
        report.table(['Field', 'Value'], [
          ['Health Factor', fHF(r.before.healthFactor)],
          ['Total Collateral', `$${f8(r.before.totalCollateralETH)}`],
          ['Total Debt', `$${f8(r.before.totalDebtETH)}`],
          ['AGT Price', `$${f8(r.before.agtPrice)}`],
        ]);
      }
    } else if (r.before && r.after) {
      if (r.txHash) report.p(`**Tx:** \`${r.txHash}\``);
      report.p(`**Verdict:** ${r.passed ? 'PASS' : 'FAIL'} - Debt liquidated **${r.debtPct}%** (expected ${r.tc.expectedPct}), Collateral seized **${r.collPct}%**`);
      report.br();
      report.detailedComparison(r.before, r.after);
    } else {
      report.p(`**ERROR:** \`${r.errorMsg?.slice(0, 300) || 'Unknown'}\``);
    }
    report.p('---');
    report.br();
  }

  // Write (timestamped filename to avoid overwriting previous reports)
  const outPath = path.join(__dirname, `liquidation-report-${fileTs}.md`);
  fs.writeFileSync(outPath, report.toString(), 'utf-8');
  console.log(`\nReport: ${outPath}`);
  console.log(`Result: ${passedCount}/${results.length} passed (${skippedCount} skipped, ${ranCount} executed)`);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
