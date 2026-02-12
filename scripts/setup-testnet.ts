/**
 * One-time testnet setup for liquidation test
 *
 * 1. Fund signers[1] (borrower) and signers[2] (liquidator) with ETH
 * 2. Add signers[0] as AGT minter
 *
 * Usage:
 *   npx hardhat run scripts/setup-testnet.ts --network arbitrumSepolia
 */
// @ts-ignore
import { ethers } from 'hardhat';

const ADDR = {
  agt: '0x408ae96165741d12f811efeba864f1ba8742cd8c',
};

const GAS = { gasLimit: 500_000 };

async function main() {
  const signers = await ethers.getSigners();
  const admin = signers[0];
  const borrower = signers[1];
  const liquidator = signers[2];

  const adminAddr = await admin.getAddress();
  const borrowerAddr = await borrower.getAddress();
  const liquidatorAddr = await liquidator.getAddress();

  console.log(`Admin:      ${adminAddr}`);
  console.log(`Borrower:   ${borrowerAddr}`);
  console.log(`Liquidator: ${liquidatorAddr}`);
  console.log('');

  // ---- 1. Fund ETH ----
  const MIN_ETH = ethers.utils.parseEther('0.05');
  const FUND_ETH = ethers.utils.parseEther('0.1');

  for (const [label, signer] of [['Borrower', borrower], ['Liquidator', liquidator]] as const) {
    const addr = await (signer as any).getAddress();
    const bal = await signer.getBalance();
    console.log(`${label} ETH: ${ethers.utils.formatEther(bal)}`);

    if (bal.lt(MIN_ETH)) {
      console.log(`  Sending ${ethers.utils.formatEther(FUND_ETH)} ETH...`);
      const tx = await admin.sendTransaction({ to: addr, value: FUND_ETH });
      await tx.wait();
      console.log(`  Done. tx: ${tx.hash}`);
    } else {
      console.log(`  Sufficient.`);
    }
  }

  console.log('');

  // ---- 2. Add signers[0] as AGT minter ----
  const minterAbi = [
    'function addMinter(address)',
    'function minters() view returns (address[])',
    'function owner() view returns (address)',
  ];
  const agt = new ethers.Contract(ADDR.agt, minterAbi, admin);

  const owner = await agt.owner();
  console.log(`AGT owner:  ${owner}`);

  // Check if already a minter
  let alreadyMinter = false;
  try {
    const minters: string[] = await agt.minters();
    console.log(`AGT minters: ${minters.join(', ')}`);
    alreadyMinter = minters.some((m: string) => m.toLowerCase() === adminAddr.toLowerCase());
  } catch (e) {
    console.log(`  Could not query minters: ${(e as any).message?.slice(0, 100)}`);
  }

  if (alreadyMinter) {
    console.log(`  signers[0] is already a minter.`);
  } else if (owner.toLowerCase() === adminAddr.toLowerCase()) {
    console.log(`  Adding signers[0] as AGT minter...`);
    const tx = await agt.addMinter(adminAddr, GAS);
    await tx.wait();
    console.log(`  Done. tx: ${tx.hash}`);
  } else {
    console.log(`  WARNING: signers[0] is NOT the AGT owner. Cannot addMinter.`);
  }

  // ---- Summary ----
  console.log('\n--- Final State ---');
  console.log(`Admin ETH:      ${ethers.utils.formatEther(await admin.getBalance())}`);
  console.log(`Borrower ETH:   ${ethers.utils.formatEther(await borrower.getBalance())}`);
  console.log(`Liquidator ETH: ${ethers.utils.formatEther(await liquidator.getBalance())}`);

  try {
    const minters: string[] = await agt.minters();
    const isMinter = minters.some((m: string) => m.toLowerCase() === adminAddr.toLowerCase());
    console.log(`AGT minter[signers[0]]: ${isMinter}`);
  } catch {}

  console.log('\nSetup complete!');
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
